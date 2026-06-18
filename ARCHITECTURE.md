# Architecture Overview — CBBC product pipeline

A scheduled Node.js/TypeScript worker that pulls a supplier product feed (Duell)
over FTP, validates and reshapes it into models + sellable variants, caps the
output, and writes it to PostgreSQL. A separate Shopify storefront sync upserts the
promoted catalogue into Shopify.

For deeper data-flow detail see [`TECHNICAL_OVERVIEW.md`](./TECHNICAL_OVERVIEW.md);
this document is the higher-level map.

## Stack

- **Runtime / language**: Node.js `>=20`, TypeScript (CommonJS, `tsc` build).
- **Scheduling**: `node-cron` (`CRON_SCHEDULE`, default `0 2 * * *`).
- **FTP**: `basic-ftp`. **CSV**: `csv-parser` (`;` delimited).
- **Logging**: `pino` + `pino-pretty`.
- **Data store**: PostgreSQL via `pg` (shared connection pool for all CRUD, migrations, and schema introspection).
- **Containerization**: `Dockerfile` + `docker-compose.yml` (worker + local Postgres).

## Modules (`src/`)

| Path | Responsibility |
|------|----------------|
| `worker.ts` | Entrypoint + cron schedule. Orchestrates the entire pipeline and holds most of the model/variant + capping business logic. |
| `config/env.ts` | Central env-var config (FTP, DB, Shopify, cron, dev flags). |
| `ftp/ftp-client.ts` | FTP connect/list/download, retry with backoff, on-disk caching. |
| `parsers/csv-parser.ts` | Per-file CSV parsers + record type definitions. |
| `validation/product-validator.ts` | `enrichProduct()` joins price/stock/image and produces `ValidatedProduct` with an `errors[]` list. |
| `filters/product-filter.ts` | Generic `ProductFilter`; effective rules are injected from `worker.ts` via `customLogic`. |
| `api/db-client.ts` | PostgreSQL client (insert/upsert/select/delete) backed by `pg.Pool`, with schema preflight. |
| `api/products-api.ts` | Staging inserts, `promoteToProduction()` (models + variants), store-agnostic sync bookkeeping (links + logs) and promoted-catalogue reads. Largest file (~1k lines), includes the `products_staging` column allowlist. |
| `db/migrate.ts`, `migration-utils.ts`, `migrations/sql/*` | Versioned SQL migrations tracked in a migrations table. |
| `db/schema-preflight.ts` | Introspects live table columns and drops unknown keys before writes. |
| `db/reset-remote.ts`, `status.ts` | Ops scripts: nuke+remigrate (guarded), schema status. |
| `shopify/shopify-client.ts`, `mappers.ts`, `push-production.ts` | Shopify GraphQL Admin client (throttle-aware), production→Shopify mappers, and the upsert/reconcile push script (`npm run shopify:push:prod`). |
| `utils/pipeline-debug.ts` | `logBoundarySample()` debug logging gated by `PIPELINE_DEBUG=1`. |
| `logger.ts` | Shared pino logger. |

## Main flow (`runPipeline` in `worker.ts`)

1. **Download** 6 CSVs from FTP into `cache/ftp/` (cached across runs; missing files
   are warned and skipped, never fatal).
2. **Parse** each CSV; normalize hyphenated supplier keys (`a-b` → `a_b`).
3. **Index** prices/stock/images into `Map`s keyed by product code (O(1) joins).
4. **Split** product rows into parent (model) rows vs variant rows; build
   `modelMetadataByCode` from parents. Sellable parent rows are also treated as variants.
5. **Enrich + validate** each variant row into a `ValidatedProduct`.
6. **Consistency check**: establish per-model "truth" (brand/vendor/category,
   parent-preferred) and drop variants that conflict.
7. **Filter** for eligibility (no errors, `stock_total > 1`, image, categories,
   brand, price+stock required).
8. **Cap**: eligible models = those with ≥1 qualifying variant; sort by valid-variant
   count then code; keep top `MVP_MODEL_LIMIT = 50`; promote all valid variants of those models.
9. **Write staging** (upsert/insert): `products_staging`, `prices_staging`,
   `stock_staging`, `images_staging`, `categories`, `category_hierarchy`.
10. **Promote** to production tables `product_models` + `product_variants`
    (FK-safe: variants kept only if their `model_code` exists in promoted models).
11. Optional dev `cleanSlate` clears tables; cache files are preserved.

Errors abort the run (logged, FTP disconnected in `finally`); the cron wrapper
catches so one failed run doesn't kill the scheduler.

**Shopify path (separate, manual):** `npm run shopify:push:prod` →
`getPromotedModelsWithVariants()` → `buildProductSetInput()` →
`ShopifyClient.productSet()` + `setInventoryQuantities()`, then reconciles deletes
against `store_product_links`. A weekly cron can be enabled via `SHOPIFY_PUSH_CRON`
(disabled by default).

## Build, run, ops

```bash
npm install
npm run build         # tsc -> dist/
npm start             # node dist/worker.js (schedules cron)
npm run dev           # ts-node-dev watch on src/worker.ts
npm run db:migrate    # apply pending SQL migrations
npm run db:status     # inspect schema
npm run shopify:push:prod  # push promoted catalogue to Shopify
npm run lint          # eslint src/**/*.ts
docker compose up     # worker + local postgres
```

Configuration is entirely via environment variables (`.env`, see `config/env.ts`):
FTP (`FTP_HOST/PORT/USER/PASS/SECURE`), DB (`DATABASE_URL`),
Shopify (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`,
`SHOPIFY_LOCATION_ID`, `SHOPIFY_PUSH_CRON`), `CRON_SCHEDULE`, `LOG_LEVEL`,
`DEV_CLEAN_SLATE`, `PIPELINE_DEBUG`. See `.env.example`. No secrets are committed.

## Risky / fragile areas

- **Business logic concentrated in `worker.ts`** (~420 lines) and a ~1k-line
  `products-api.ts`. Model/variant reconstruction, consistency truth, eligibility
  and capping are intertwined and largely untyped (`any`), making changes risky.
- **No automated tests.** `npm test` runs `jest`, but there are no `*.test.ts`
  files and no jest config; `test-pipeline.ts` at the root is a manual script, not
  a suite. The build is the only real safety net.
- **Shopify push reads production tables as the source of truth.** Deletions are
  reconciled against what is currently in `product_models` / `product_variants`,
  so for a variant to be removed from Shopify it must actually be absent from the
  production tables (promotion currently upserts and does not prune stale rows).
- **Migrations are not run by the worker.** `runMigrations()` is only invoked by
  `db:migrate` and `reset-remote`; a fresh deploy that skips `db:migrate` will fail
  writes. The runtime relies on `schema-preflight` silently dropping unknown columns,
  which can mask schema drift instead of surfacing it.
- **Hard 50-model cap** (`MVP_MODEL_LIMIT`) is a constant in code, not config — easy
  to forget when scaling past the MVP phase.
- **FTP over potentially insecure TLS**: when `FTP_SECURE=true`, `rejectUnauthorized:false`
  disables cert verification (accepts self-signed certs).
- **Naive SQL-injection heuristic** in the validator (rejects rows containing
  `;`, `--`, `drop`, `select`) can produce false positives on legitimate product text;
  it is not a substitute for parameterized queries.
- **Stale/cached FTP files**: `downloadWithCache` reuses any existing local file and
  never refreshes it, so a stuck cache silently serves old data across runs.
- **No graceful shutdown / no health endpoint**: the worker is a bare cron process
  (Dockerfile exposes no port), so observability is log-only.
