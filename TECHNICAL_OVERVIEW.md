# Technical Overview

Deep dive into data flow, table structure, filtering logic, and Shopify mapping.

For operational guidance (how to run, deploy, configure), see [PIPELINE_GUIDE.md](./PIPELINE_GUIDE.md).

---

## Entrypoints

| File | Role |
|------|------|
| `src/worker.ts` | Main entrypoint. Orchestrates the full pipeline: FTP download → parse → enrich → filter → cap → staging → promotion. In prod, registers cron. In dev, runs on boot then triggers Shopify push. |
| `src/shopify/push-production.ts` | Shopify push. Reads promoted data from DB and syncs to Shopify. Can run standalone (`npm run shopify:push:prod`) or is called by `worker.ts` in dev mode. |

## Module map

| Path | Responsibility |
|------|----------------|
| `config/env.ts` | Central configuration from env vars. Controls all dev/prod behavior switches. |
| `ftp/ftp-client.ts` | FTP connect, download with retry/backoff, on-disk caching (`cache/ftp/`). |
| `parsers/csv-parser.ts` | Per-file CSV parsers (semicolon-delimited). Returns typed arrays. |
| `validation/product-validator.ts` | `enrichProduct()` — joins a product row with its price/stock/image, produces `ValidatedProduct` with `errors[]`. |
| `filters/product-filter.ts` | Generic filter; effective rules injected from `worker.ts` via `customLogic`. |
| `api/db-client.ts` | PostgreSQL client wrapping `pg.Pool`. Provides `insert`, `upsert`, `select`, `delete`. Registers NUMERIC type parser (OID 1700 → `parseFloat`). |
| `api/products-api.ts` | Staging inserts, `promoteToProduction()`, store-link bookkeeping, promoted-catalogue reads. ~1k lines. |
| `db/migrate.ts` | Applies pending SQL migrations from `migrations/sql/`. |
| `db/migration-utils.ts` | Shared utilities: `createClient`, `listMigrationFiles`, `getAppliedMigrations`. |
| `db/schema-preflight.ts` | Introspects live table columns, drops keys not in the schema before writes. |
| `db/drift-check.ts` | Compares migration files on disk vs. `schema_migrations` table. |
| `db/reset-remote.ts` | Drops all public schema objects and re-runs migrations. Guarded by `NODE_ENV=development` + `CONFIRM_NUKE=YES`. |
| `shopify/shopify-client.ts` | Shopify GraphQL Admin client with throttle-aware retry. |
| `shopify/mappers.ts` | Maps production DB rows → Shopify `ProductSetInput`. |
| `shopify/content-hash.ts` | Computes content hashes to skip unchanged models during push. |
| `utils/pipeline-debug.ts` | `logBoundarySample()` — logs sample records at pipeline boundaries when `LOG_LEVEL=debug`. |
| `logging/run-context.ts` | `RunContext` — per-run logger with unique run ID and timing. |

---

## Data flow (pipeline steps)

### 1. FTP download

Downloads 6 CSV files into `cache/ftp/`:

| Remote path | Local filename |
|-------------|---------------|
| `/Data/Products/products.csv` | `products.csv` |
| `/Retail_pricelist.csv` | `prices.csv` |
| `/ic_CSV.csv` | `stock_product.csv` |
| `/Data/product_category_descriptions.csv` | `categories.csv` |
| `/Data/product_category_hierarchy.csv` | `category_hierarchy.csv` |
| `/Data/product_images.csv` | `images.csv` |

In dev mode, cached files are reused across runs. In prod mode, cache is cleared at the start of each run.

### 2. Parse CSV

Each file is parsed via streaming `csv-parser` (semicolon delimiter) into typed arrays. Missing files are skipped with a warning.

### 3. Normalize keys

Supplier column names containing hyphens are normalized: `product-code` → `product_code` (in-place on each record).

### 4. Build lookup maps

Prices, stock, and images are indexed into `Map<product_code, record>` for O(1) joins during enrichment.

### 5. Split parent vs. variant rows

The products CSV contains two types of rows:
- **Parent rows** (`parent` field empty): represent the model/group. Used for model-level metadata.
- **Variant rows** (`parent` field = model code): represent sellable SKUs.

Parent rows that are "sellable" (have barcode, price, stock, image, name, brand, vendor, categories) are also treated as variants.

`modelMetadataByCode` is built from parent rows — stores model-level names, brand, vendor, categories.

### 6. Enrich + validate

Each variant row is joined with its price, stock, and image via the lookup maps. `ProductValidator.enrichProduct()` produces a `ValidatedProduct` with:
- Computed fields: `model_code`, `price_eur_excl_vat`, `stock_total`, `image_url`, `barcode`
- `errors[]`: list of validation failures

### 7. Model consistency check

For each model code, a "truth" is established (brand, vendor, category_codes) — preferring parent metadata when available, falling back to the first variant.

Variants whose brand/vendor/categories conflict with their model truth are dropped.

### 8. Filter for eligibility

A variant qualifies when:
- `errors.length === 0`
- `stock_total > 1`
- Has `image_url`
- Has `category_codes` (non-empty array)
- Has `brand`
- Has price and stock (required by filter config)

### 9. Cap by model count

Eligible models = those with at least one qualifying variant.

Sorting: by valid-variant count (descending), then by model code (ascending) for determinism.

The top N models are kept (N = `PIPELINE_MODEL_LIMIT`; 0 = unlimited). All valid variants of selected models are promoted.

### 10. Write staging tables

Only data for the capped/selected product codes is written:

| Table | Method | Key |
|-------|--------|-----|
| `products_staging` | upsert | `product_code` |
| `prices_staging` | upsert | `product_code` |
| `stock_staging` | upsert | `product_code, source` |
| `images_staging` | insert | — |
| `categories` | upsert | `category_code` |
| `category_hierarchy` | upsert | `category_code, parent_category_code` |

A schema preflight runs before writes: introspects the live table columns and drops any keys from the data that don't exist in the schema.

### 11. Promote to production

Creates/updates rows in:
- `product_models` — one row per model code
- `product_variants` — one row per product code, FK to `product_models.model_code`

Model metadata is sourced from `modelMetadataByCode` (parent rows) when available, otherwise from the first representative variant.

FK safety: variants are only written if their `model_code` exists in the promoted model set.

---

## Shopify push flow

### Triggered by

- **Dev mode**: automatically after pipeline completes (called from `worker.ts`)
- **Prod mode**: on its own cron schedule (`SHOPIFY_PUSH_CRON`), registered by `worker.ts`
- **Manual**: `npm run shopify:push:prod`

### Steps

1. `getPromotedModelsWithVariants()` — reads `product_models` + `product_variants` (paginated), groups variants under their model. Respects `SHOPIFY_PUSH_MODEL_LIMIT`.
2. For each model:
   - Compute content hash of current data
   - Compare against stored hash in `store_product_links`
   - If unchanged and `SHOPIFY_FORCE_PUSH` is not set → skip
   - Otherwise: `buildProductSetInput()` → `ShopifyClient.productSet()` (upsert product + variants)
3. `setInventoryQuantities()` — writes stock to a single Shopify location per variant.
4. Upserts into `store_product_links` / `store_variant_links` (maps model/variant → Shopify IDs).
5. **Reconciliation**: models in link tables that are no longer in the promoted set → delete from Shopify, remove links.

### Shopify field mapping

| Source (production DB) | Shopify field |
|---|---|
| `product_models.model_code` | Product handle `cbbc-{model_code}` + metafield `cbbc.model_code` |
| `product_models.name_en` | Product title |
| `product_models.vendor_name` | Product vendor |
| `product_models.category_codes` | Product tags |
| `product_variants.product_code` | Variant SKU |
| `product_variants.name_en` | Variant option value (multi-variant models); default option for single-variant |
| `product_variants.barcode` | Variant barcode |
| `product_variants.price_dkk_excl_vat` | Variant price (EUR → DKK at 7.47417, excl. VAT) |
| `product_variants.stock_total` | Inventory quantity |
| `product_variants.image_url` | Product/variant media |

Products are matched by deterministic handle; variants by SKU. `productSet` reconciles variants automatically — a variant removed from a model's set is removed from the Shopify product.

---

## Database schema

All tables live in the `public` schema. Defined in `src/db/migrations/sql/0001_init.sql`.

### Staging tables

Written by the pipeline with capped/filtered supplier data.

- **`products_staging`** — raw product attributes (codes, names, brand, vendor, categories, barcode). PK: `product_code`.
- **`prices_staging`** — price per product code. PK: `product_code`.
- **`stock_staging`** — stock levels per product code + source. PK: `(product_code, source)`.
- **`images_staging`** — image URLs per product code.
- **`categories`** — category code + descriptions. PK: `category_code`.
- **`category_hierarchy`** — parent/child category relationships. PK: `(category_code, parent_category_code)`.

### Production tables

Normalized, promoted data — source of truth for Shopify.

- **`product_models`** — one row per model. PK: `model_code`. Contains model-level name, brand, vendor, categories.
- **`product_variants`** — one row per sellable SKU. PK: `product_code`. FK: `model_code` → `product_models`. Contains price (EUR + DKK), stock, barcode, image URL.

### Store sync tables

- **`store_product_links`** — maps `model_code` → Shopify product ID + handle + content hash.
- **`store_variant_links`** — maps `product_code` → Shopify variant ID.
- **`store_sync_logs`** — audit trail of push operations (timestamp, status, counts).

### Migrations table

- **`schema_migrations`** — tracks applied migration filenames + timestamps.

---

## Known limitations

- **No automated tests.** The build (`tsc`) is the only safety net.
- **Business logic concentrated in `worker.ts` (~435 lines) and `products-api.ts` (~1k lines).** Model/variant reconstruction, consistency checking, and capping are intertwined.
- **Migrations are not auto-applied.** A fresh deploy without `npm run db:migrate` will fail on writes.
- **Single Shopify location.** Inventory is written to one location only.
- **Promotion upserts but does not prune stale rows.** If a variant was previously promoted but is no longer eligible, it stays in `product_variants` until the next push reconciliation removes it from Shopify. The DB row persists.
