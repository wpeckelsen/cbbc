# Pipeline Guide

How to operate, configure, and deploy the CBBC product pipeline.

---

## High-level flow

```
Duell FTP (CSV files)
    │
    ▼
┌─────────────────────────────────────┐
│  Pipeline (worker.ts)               │
│  1. Download CSVs from FTP          │
│  2. Parse + normalize               │
│  3. Enrich (join price/stock/image) │
│  4. Validate + filter               │
│  5. Cap by model count              │
│  6. Write to staging tables         │
│  7. Promote to production tables    │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Shopify Push (push-production.ts)  │
│  1. Read promoted models + variants │
│  2. Upsert to Shopify via GraphQL   │
│  3. Set inventory quantities        │
│  4. Reconcile deletions             │
└─────────────────────────────────────┘
    │
    ▼
Shopify storefront (live products)
```

---

## External tools & where to look

| What | Where |
|------|-------|
| Raw CSV data from supplier | FTP: `updateftp.duell.fi` (use any FTP client, or inspect cached files in `cache/ftp/`) |
| Inspect CSV files visually | [RowZero](https://rowzero.io) — open the downloaded CSVs for exploration |
| Database (tables, queries) | [Railway dashboard](https://railway.app) → your project → Postgres service → Data tab |
| Hosted worker service | Railway dashboard → your project → `cbbc` service (logs, env vars, deployments) |
| Shopify products & storefront | Shopify Admin → Products; or view the live storefront |

---

## npm scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Runs pipeline immediately via `ts-node-dev` (hot reload). Pipeline + Shopify push fire on boot. |
| `npm run build` | Compiles TypeScript → `dist/` |
| `npm start` | Runs `node dist/worker.js`. In prod: registers cron, sits idle. In dev: runs immediately. |
| `npm run shopify:push:prod` | Manually triggers a Shopify push (standalone, doesn't need the pipeline). |
| `npm run shopify:auth` | One-time OAuth flow to get Shopify access token. Opens browser. |
| `npm run db:migrate` | Applies pending SQL migrations to the connected database. |
| `npm run db:status` | Shows which migrations are applied and which are pending. |
| `npm run db:check` | Drift check: compares migration files on disk vs. what's recorded in the DB. |
| `npm run db:reset:remote` | **Destructive.** Drops all tables and re-runs migrations. Requires `ENV=dev` + `CONFIRM_NUKE=YES`. |
| `npm test` | Runs Jest (no test files currently exist). |
| `npm run lint` | ESLint on `src/**/*.ts`. |
| `npm run docker:build` | Builds Docker image. |
| `npm run docker:run` | Runs container with `.env` file. |

---

## Environment variables (levers)

All configuration is via env vars. See `.env.example` for the full list with comments.

### Core behavior

| Variable | Values | Effect |
|----------|--------|--------|
| `ENV` | `dev` / `prod` | **Required, no default.** Controls caching, model caps, brand filter, and DB URL preference. |

### Model limits (dev-only, required)

| Variable | Dev | Prod | Effect |
|----------|-----|------|--------|
| `PIPELINE_MODEL_LIMIT` | **required** (`0` = unlimited) | ignored (always unlimited) | Max models promoted to production tables per pipeline run. |
| `SHOPIFY_PUSH_MODEL_LIMIT` | **required** (`0` = unlimited) | ignored (always unlimited) | Max models pushed to Shopify per push run. |

Set to a small number (e.g. `5`) when testing to keep runs fast and avoid polluting Shopify with test products. These vars are ignored in prod — production is never capped.

### Database

| Variable | Effect |
|----------|--------|
| `DATABASE_URL` | Internal Railway hostname (fast, free bandwidth). Preferred in prod. |
| `DATABASE_PUBLIC_URL` | Public TCP proxy URL. Preferred in dev (reachable from outside Railway). |

The code picks the right one based on `ENV`. You can set both; no need to comment/uncomment.

### FTP

| Variable | Effect |
|----------|--------|
| `FTP_HOST` | Supplier FTP hostname (default: `updateftp.duell.fi`) |
| `FTP_USER` / `FTP_PASS` | FTP credentials |
| `FTP_SECURE` | `true` for FTPS |
| `FTP_REJECT_UNAUTHORIZED` | `true` (default) to verify TLS cert; `false` for self-signed |

### Shopify

| Variable | Effect |
|----------|--------|
| `SHOPIFY_STORE_DOMAIN` | e.g. `your-store.myshopify.com` |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_SECRET` | App credentials |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Obtained via `npm run shopify:auth` |
| `SHOPIFY_API_VERSION` | GraphQL API version (default: `2024-10`) |
| `SHOPIFY_LOCATION_ID` | Inventory location for stock writes |

### Brand filter

| Variable | Dev | Prod | Effect |
|----------|-----|------|--------|
| `BRAND_FILTER_ENABLED` | **required** (`true`/`false`) | ignored (always on) | Only process brands listed in `brands.md`. An empty `brands.md` means "allow all brands". |

Log level is fixed (`debug` dev / `info` prod). Memory (`NODE_OPTIONS`) is set in the Dockerfile.

---

## Dev vs. Prod behavior

| | Dev (`ENV=dev`) | Prod (`ENV=prod`) |
|---|---|---|
| Run trigger | Railway Cron Job (or `npm run dev`) runs pipeline → Shopify push once, then exits | Railway Cron Job runs pipeline → Shopify push once, then exits |
| FTP cache | Persists between runs (fast iteration) | Cleared each run (always fresh data) |
| Model limit | Required (`PIPELINE_MODEL_LIMIT` / `SHOPIFY_PUSH_MODEL_LIMIT`) | Unlimited (ignored) |
| Brand filter | Required (`BRAND_FILTER_ENABLED`) | Always on |
| Log level | `debug` | `info` |
| DB URL | Prefers `DATABASE_PUBLIC_URL` | Prefers `DATABASE_URL` |

---

## Railway deployment

### Required env vars on Railway

```
ENV=prod
DATABASE_URL=           (auto-set by Railway Postgres plugin)
DATABASE_PUBLIC_URL=    (auto-set by Railway Postgres plugin)
FTP_HOST=updateftp.duell.fi
FTP_USER=...
FTP_PASS=...
SHOPIFY_STORE_DOMAIN=...
SHOPIFY_ADMIN_ACCESS_TOKEN=...
SHOPIFY_API_VERSION=2024-10
SHOPIFY_LOCATION_ID=...
```

### First-time setup for a new Railway database

The pipeline does NOT run migrations automatically. On a fresh DB:

```bash
# From your local machine (with DATABASE_PUBLIC_URL in .env pointing to the new DB):
npm run db:migrate

# Or via Railway CLI:
railway run npm run db:migrate
```

This creates all tables from `0001_init.sql`. After that, the scheduled pipeline will work.

### Memory requirements

The pipeline parses ~127k CSV rows into memory. Peak usage is ~500MB–1GB.

- **Railway Trial plan (512MB)**: Not enough. Pipeline will OOM.
- **Railway Hobby plan ($5/mo, up to 8GB per replica)**: Works fine. (`NODE_OPTIONS` is set in the Dockerfile.)

### Deploying a dev build on Railway

If you want to deploy a dev build (e.g. to test with small model limits):

```
ENV=dev
PIPELINE_MODEL_LIMIT=5
SHOPIFY_PUSH_MODEL_LIMIT=5
BRAND_FILTER_ENABLED=true
```

Dev runs are triggered via the same Railway Cron Job (or `npm run dev` locally). The three dev-only vars above are **required** in dev.

---

## Database operations

### Tables

**Staging** (raw supplier data, capped to selected models):
- `products_staging`, `prices_staging`, `stock_staging`, `images_staging`
- `categories`, `category_hierarchy`

**Production** (normalized, promoted data — source of truth for Shopify):
- `product_models`, `product_variants`

**Bookkeeping**:
- `store_product_links`, `store_variant_links` — maps model/variant to Shopify IDs
- `store_sync_logs` — audit log of Shopify push operations
- `schema_migrations` — tracks which SQL migrations have been applied

### Useful commands

```bash
# Check migration status
npm run db:status

# Apply pending migrations
npm run db:migrate

# Check for drift (pending or orphaned migrations)
npm run db:check

# Nuclear reset (drops everything, re-runs migrations)
# Requires ENV=dev and CONFIRM_NUKE=YES
npm run db:reset:remote
```

### Migrations

All migrations live in `src/db/migrations/sql/`. The current schema is defined in `0001_init.sql` (a consolidated migration covering the full table structure).

The pipeline runs a **drift check** on boot (compares migration files on disk vs. `schema_migrations` table). If migrations are pending, it logs a warning but continues — it does not apply them automatically.

---

## Shopify integration

### How it works

1. Reads `product_models` + `product_variants` from the database
2. For each model: builds a Shopify `ProductSetInput` and upserts via GraphQL
3. Sets inventory quantities per variant at a single Shopify location
4. Records mappings in `store_product_links` / `store_variant_links`
5. **Reconciliation**: any model in the link tables that is no longer promoted gets deleted from Shopify

### Pricing

Variant prices are converted from EUR to DKK (rate: 7.47417) and pushed **excluding VAT**. Configure your Shopify store so prices do not include tax — Shopify adds VAT at checkout.

### Content hashing

The push uses content hashes to skip models that haven't changed since the last push.

### Initial Shopify setup

1. Create a custom app in Shopify Admin (Settings → Apps → Develop apps)
2. Required scopes: `read_products`, `write_products`, `read_inventory`, `write_inventory`
3. Set `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_SECRET` in `.env`
4. Run `npm run shopify:auth` — this opens a browser, you authorize, and the access token is saved to `.env`
5. Set `SHOPIFY_LOCATION_ID` (find it in Shopify Admin → Settings → Locations)

---

## Shared resources warning

Local dev and Railway deployment can share the **same database** and **same Shopify store**. Running from both simultaneously can overwrite each other's data. Keep model limits low during local dev to minimize impact.
