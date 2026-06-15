# Technical overview: CBBC product pipeline

## Purpose

This service ingests a supplier product feed (Duell FTP CSV exports), normalizes and validates it, selects a capped subset of “good” products, and writes both staging and production-ready tables in Supabase. A separate Shopify integration pushes the promoted catalogue (models + variants) to a Shopify storefront.

## Tech stack

- **Runtime**: Node.js (see `package.json`, engine `>=20`)
- **Language**: TypeScript
- **Scheduling**: `node-cron`
- **FTP**: `basic-ftp`
- **CSV parsing**: `csv-parser`
- **Logging**: `pino` + `pino-pretty`
- **Database access**
  - **Supabase REST API** for inserts/upserts/selects (`src/api/supabase-client.ts`)
  - **Direct Postgres** via `pg` for migrations and schema introspection (`src/db/migrate.ts`, `src/db/schema-preflight.ts`)
- **Containerization**: Docker (`Dockerfile`, `docker-compose.yml`)

## Main entrypoints

- **Pipeline worker**: `src/worker.ts`
- **Supabase operations / promotion logic**: `src/api/products-api.ts`
- **Supabase REST client**: `src/api/supabase-client.ts`
- **Validation + enrichment**: `src/validation/product-validator.ts`
- **Filtering**: `src/filters/product-filter.ts`
- **Shopify push script**: `src/shopify/push-production.ts` (`npm run shopify:push:prod`)
- **Shopify GraphQL client**: `src/shopify/shopify-client.ts`
- **Production → Shopify mappers**: `src/shopify/mappers.ts`

## Data flow (authoritative)

### 1) FTP download

Implemented in `src/worker.ts` using `FtpClient`.

The worker downloads into a persistent cache directory so subsequent runs can reuse files:

- Local cache: `cache/ftp/` (under the repo)

Files downloaded by the worker today:

- `/Data/Products/products.csv` -> `products.csv`
- `/Retail_pricelist.csv` -> `prices.csv`
- `/ic_CSV.csv` -> `stock_product.csv`
- `/Data/product_category_descriptions.csv` -> `categories.csv`
- `/Data/product_category_hierarchy.csv` -> `category_hierarchy.csv`
- `/Data/product_images.csv` -> `images.csv`

Note: a stock-by-EAN file exists in the supplier docs, and is used in `test-pipeline.ts`, but is not currently downloaded in `src/worker.ts`.

### 2) Parse CSV

Parsing functions live in `src/parsers/csv-parser.ts` and yield arrays of records like:

- `products[]`
- `prices[]`
- `stock_product[]`
- `categories[]`
- `category_hierarchy[]`
- `images[]`

### 3) Normalize supplier key quirks

In `src/worker.ts` the pipeline normalizes supplier column names that contain hyphens by replacing `-` with `_` (in-place).

### 4) Enrich into canonical validated products (variants)

Validation and enrichment is performed by `ProductValidator.enrichProduct()`.

Core behavior:

- Each product row is joined (in-memory) to:
  - a price row by product code
  - a stock row by product code
  - an image row by product code
- `model_code` is derived as:
  - `parent` when `parent` is present
  - otherwise `product_code`

### 5) Model/variant reconstruction (parent-preferred metadata)

The supplier feed includes both:

- **Parent rows**: `parent` empty; represent the model
- **Variant rows**: `parent` non-empty; represent sellable SKUs

The worker:

- Splits the products feed into parent vs variant rows.
- Builds a `modelMetadataByCode` map from parent rows.
- Treats “sellable parent rows” as variants as well (only when they are complete enough to be sellable).

Consistency enforcement:

- For each model code, the pipeline establishes a “model truth” (brand/vendor/category) preferring parent metadata when present.
- Variants that conflict with that truth are dropped.

### 6) Filtering and eligibility

Filtering uses `ProductFilter` but the effective logic is set in `src/worker.ts` via `customLogic`.

In practice, qualifying variants must:

- Have no validation errors
- Have stock total > 1
- Have an image URL
- Have categories
- Have a brand
- And satisfy `requiresPrice: true` and `requiresStock: true`.

The pipeline then computes **eligible models** as:

- Any model that has at least 1 qualifying variant.

### 7) Capping (current behavior)

The worker caps by model count:

- `MVP_MODEL_LIMIT = 50`

Algorithm:

- Determine eligible model codes.
- Sort eligible model codes by “valid variant count” (descending), then by model code (ascending) for deterministic behavior.
- Keep the top 50 models.
- Promote all valid variants belonging to those selected models.

### 8) Write staging tables (Supabase)

Staging writes occur via Supabase REST API in `src/api/products-api.ts`:

- `products_staging` (upsert)
- `prices_staging` (upsert)
- `stock_staging` (insert)
- `images_staging` (insert)
- `categories` (upsert)
- `category_hierarchy` (upsert)

Notes:

- `products_staging` uses an explicit allowlist of columns (`PRODUCTS_STAGING_COLUMNS`) to enforce the staging contract.
- Supabase writes also run a schema preflight that introspects the DB and drops unknown keys if the schema has changed (`src/db/schema-preflight.ts`).

### 9) Promote to production tables (Supabase)

Promotion is implemented in `promoteToProduction()`.

Current production tables:

- `product_models`
- `product_variants`

The promotion logic:

- Rejects variants with validation errors.
- Derives `model_code` for each variant.
- Promotes:
  - models (one per `model_code`)
  - then variants (one per `product_code`)
- Model metadata is built from:
  - `modelMetadataByCode` (from parent rows) when present
  - otherwise from the first representative variant

Foreign-key safety:

- Variants are filtered to only those whose `model_code` exists in the promoted model set.

### 10) Observability / debug boundaries

When `LOG_LEVEL=debug`, the pipeline logs “boundary samples” (keys + a sample record) at multiple points using `logBoundarySample()` in `src/utils/pipeline-debug.ts`.

## Shopify integration

A separate, manually-triggered step (`npm run shopify:push:prod`, optionally a weekly
cron via `SHOPIFY_PUSH_CRON`) pushes the promoted catalogue to Shopify via the GraphQL
Admin API.

Flow (`src/shopify/push-production.ts`):

1. `getPromotedModelsWithVariants()` reads `product_models` + `product_variants`
   (paginated) and groups variants under their model.
2. For each model, `buildProductSetInput()` maps it to a Shopify `ProductSetInput`
   and `ShopifyClient.productSet()` upserts the product + all its variants in one call.
3. Inventory is written per variant to a single location via `setInventoryQuantities()`.
4. Local mappings are recorded in `store_product_links` / `store_variant_links`.
5. **Reconciliation**: any model in the link tables that is no longer in the promoted
   set has its Shopify product deleted and its links removed.

Mapping rules:

| Source (production) | Shopify |
|---|---|
| `product_models.model_code` | product `handle` = `cbbc-{model_code}` + metafield `cbbc.model_code` |
| `product_models.name_en` | product `title` |
| `product_models.vendor_name` | product `vendor` (note: `brand` is dropped) |
| `product_models.category_codes` | product `tags` |
| `product_variants.product_code` | variant `sku` |
| `product_variants.name_en` | variant option value (multi-variant models only; single-variant models use the default option) |
| `product_variants.barcode` | variant `barcode` |
| `product_variants.price_eur_excl_vat` | variant `price` (Shopify adds VAT) |
| `product_variants.stock_total` | inventory quantity (single location) |
| `product_variants.image_url` | product/variant media |

Idempotency: products are matched by the deterministic handle (and stored external
id); variants by `sku`. `productSet` reconciles variants by SKU automatically, so a
variant removed from a model's set is removed from the Shopify product.

Bookkeeping tables (store-agnostic, migration `0006`): `store_product_links`,
`store_variant_links`, `store_sync_logs`.

## Security / sanitization expectations

- Do not commit secrets. Configuration comes from environment variables (`src/config/env.ts`).
- Documentation should refer to systems (Duell FTP, Supabase, Shopify) but must not include credentials or sensitive URLs/tokens.
