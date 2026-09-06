# Deployment Guide

How to deploy and operate the CBBC product pipeline on Railway.

---

## Architecture

A single Railway **Cron Job** runs `node dist/worker.js` on a schedule. The
worker runs the full flow **once and exits**:

1. **FTP pipeline** — download → parse → filter → promote to the production DB.
2. **Shopify push** — read the promoted catalogue, upsert products + inventory.

There is no always-on process and no in-app scheduler. Railway's Cron Job owns
the timing, so the service only consumes resources while it is actually running.

---

## One-time setup (Railway)

1. **Postgres** — the Railway Postgres plugin provides `DATABASE_URL` (private
   internal URL) and `DATABASE_PUBLIC_URL` (external TCP proxy URL). Keep
   `DATABASE_URL` for prod so the worker reaches the DB over the private
   network (no egress fees).

2. **Apply migrations** — before the first run:
   ```bash
   npm run db:migrate
   ```
   This creates all tables, including `product_pipeline_status` (the product
   trace). The pipeline does **not** auto-apply migrations — it only warns via a
   drift check.

3. **Cron schedule** — in the `cbbc` service → **Settings → Cron Schedule**, set
   a crontab expression (UTC). For example:
   - Weekly (Monday 03:00 UTC): `0 3 * * 1`
   - Daily (03:00 UTC): `0 3 * * *`

4. **Start command** — keep the default `node dist/worker.js`.

5. **Environment variables** — see `.env.example`. Required in prod:
   - `ENV=prod`
   - FTP, Shopify, and DB credentials.
   - Model limits and `BRAND_FILTER_ENABLED` are **ignored in prod** (always
     unlimited; brand filter always on).

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `ENV` | yes | `dev` or `prod`. No default — the process refuses to start without it. |
| `FTP_HOST` / `FTP_USER` / `FTP_PASS` / `FTP_PORT` / `FTP_SECURE` / `FTP_REJECT_UNAUTHORIZED` | yes | Supplier FTP. Never hard-coded. |
| `DATABASE_URL` / `DATABASE_PUBLIC_URL` | yes | prod prefers `DATABASE_URL` (internal), dev prefers public. |
| `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_CLIENT_ID` / `SHOPIFY_SECRET` / `SHOPIFY_ADMIN_ACCESS_TOKEN` / `SHOPIFY_API_VERSION` / `SHOPIFY_PUBLICATION_ID` / `SHOPIFY_LOCATION_ID` | yes | Shopify integration. |
| `PIPELINE_MODEL_LIMIT` | dev only | Required in dev (`0` = unlimited); ignored in prod. |
| `SHOPIFY_PUSH_MODEL_LIMIT` | dev only | Required in dev (`0` = unlimited); ignored in prod. |
| `BRAND_FILTER_ENABLED` | dev only | Required in dev (`true`/`false`); always on in prod. |

Removed levers (no longer read): `CRON_SCHEDULE`, `SHOPIFY_PUSH_CRON`,
`RUN_ON_STARTUP`, `SHOPIFY_FORCE_PUSH`, `SHOPIFY_PUBLISH_BACKLOG`,
`DEV_CLEAN_SLATE`, `LOG_LEVEL`, `NODE_OPTIONS`, `NODE_ENV`, and all `EMAIL_*`.

Log level is fixed (`debug` dev / `info` prod). Memory (`NODE_OPTIONS`) is set in
the Dockerfile.

---

## Local development

```bash
cp .env.example .env
# set ENV=dev and the three dev-only levers:
#   PIPELINE_MODEL_LIMIT=5
#   SHOPIFY_PUSH_MODEL_LIMIT=5
#   BRAND_FILTER_ENABLED=true
npm run db:migrate
npm run dev     # runs pipeline → Shopify push once, then exits
```

---

## Manual commands

| Command | What |
|---|---|
| `npm run shopify:push:prod` | Run only the Shopify push (standalone), then exit. |
| `npm run db:migrate` | Apply pending migrations. |
| `npm run db:status` | Show migration status. |
| `npm run db:check` | Drift check (files vs. applied migrations). |
| `npm run db:reset:remote` | **Destructive.** Requires `ENV=dev` + `CONFIRM_NUKE=YES`. |

---

## Product trace (`product_pipeline_status`)

Every run writes one row per product with a `status` (`promoted` / `rejected`)
and a JSONB `journey` recording where the product was rejected (or promoted).

Stages: `brand_filter`, `parent_pre_screen`, `consistency`, `eligibility`,
`model_cap`, `promoted`, `stale_cleanup`.

Searchable by `barcode`, `product_code`, or `name_en`. Only the latest **8 runs**
are retained (older runs are pruned).

Query example:

```sql
SELECT product_code, barcode, name_en, status, journey
FROM product_pipeline_status
WHERE barcode = '6412345678901'
ORDER BY created_at DESC;
```

---

## Verification after deploy

1. Redeploy, then watch the first cron run in the logs.
2. Confirm it logs `Pipeline done — production data updated. Starting Shopify push.`
   and then `=== CBBC run: complete ===`, and the service goes back to sleep.
3. Confirm trace rows appear in `product_pipeline_status`.
