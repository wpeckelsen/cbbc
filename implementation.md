# Implementation for FTP Product Sync Service

## Summary
This service imports product data from the Duell FTP file share, validates it, stores it in PostgreSQL, and syncs validated products to Ecwid. The newly added text format is readable and sufficiently detailed for implementation. It is currently the best available format for specification; actual data files should remain as CSVs.

## Source Files and Locations

### Product data
- `products.csv` or `products_updated-yyyyMMddTHHmmss.csv`
- Location: `/Data/Products/`
- Update interval: once a day
- Key identifier: `product_code`

### Prices
- `Retail_pricelist.csv`
- Location: `/`
- Update interval: every other hour
- Key identifier: `PRODUCT_CODE`
- Price fields include `EUR_EXCL_VAT`, `EUR_INCL_VAT`, `EUR_EXCL_VAT_EU`, `EUR_INCL_VAT_EU`, `SEK_EXCL_VAT`, `SEK_INCL_VAT`, `NOK_EXCL_VAT`, `NOK_INCL_VAT`, `GBP_EXCL_VAT`, `DKK_EXCL_VAT`, `DKK_INCL_VAT`

### Stock levels
- `ic_CSV.csv` (product-code-based)
- `ic_ean_CSV.csv` (EAN-based)
- Location: `/`
- Update interval: every 30 minutes
- Key identifier: `PRODUCT_CODE` or `EAN`

### Categories
- `product_category_descriptions.csv`
- `product_category_hierarchy.csv`
- Location: `/Data/`
- Update interval: once a week

### Pictures
- `product_images.csv`
- Location: `/Data/`
- Update interval: once a day
- Key identifier: `PRODUCT_CODE`

### Optional Parts Search files
- `Applications_data.xlsx`
- Location: `/Applications_Data/`
- Update interval: once a month
- This is outside the initial Ecwid sync scope and requires separate agreement.

### Tyre search
- `tyres.csv`
- Location: `/Data/`
- Update interval: once a week
- Key identifier: `PRODUCT_CODE`

## Implementation Notes

### Canonical identifier
- Use `product_code` / `PRODUCT_CODE` as the canonical SKU and unique product key.
- `PRODUCT_ID` in price files can be ignored for automated pipeline logic.
- Use `EAN` only where product mapping by barcode is required; primary join is `product_code`.

### File selection logic
- For product files, choose the latest `products*.csv` file based on filename timestamp or modification time.
- For price and stock files, choose the latest available file from the fixed filenames.
- For categories and images, use the latest current copy from the indicated locations.

## Data Model

### Tables

#### `products_staging`
- `product_code` TEXT PRIMARY KEY
- `categories` TEXT
- `family` TEXT
- `parent` TEXT
- `one_variant` BOOLEAN
- `customs_pos` TEXT
- `product_model_name_en` TEXT
- `product_model_name_fi` TEXT
- `product_model_name_sv` TEXT
- `vendor_name` TEXT
- `country_origin` TEXT
- `vak_code` TEXT
- `yk_no` TEXT
- `supplier_product_code` TEXT
- `catalog_restriction` TEXT
- `material` TEXT
- `make_model` TEXT
- `brand` TEXT
- `short_description_en` TEXT
- `short_description_fi` TEXT
- `short_description_sv` TEXT
- `long_description_en` TEXT
- `long_description_fi` TEXT
- `long_description_sv` TEXT
- `product_name_en` TEXT
- `product_name_fi` TEXT
- `product_name_sv` TEXT
- `barcode` TEXT
- `compound` TEXT
- `lug_height` NUMERIC
- `lug_height_unit` TEXT
- ...
- `created` TIMESTAMPTZ
- `updated` TIMESTAMPTZ
- `raw_hash` TEXT
- `imported_at` TIMESTAMPTZ

#### `prices_staging`
- `product_code` TEXT PRIMARY KEY
- `eur_excl_vat` NUMERIC
- `eur_incl_vat` NUMERIC
- `eur_excl_vat_eu` NUMERIC
- `eur_incl_vat_eu` NUMERIC
- `sek_excl_vat` NUMERIC
- `sek_incl_vat` NUMERIC
- `nok_excl_vat` NUMERIC
- `nok_incl_vat` NUMERIC
- `gbp_excl_vat` NUMERIC
- `dkk_excl_vat` NUMERIC
- `dkk_incl_vat` NUMERIC
- `imported_at` TIMESTAMPTZ

#### `stock_staging`
- `product_code` TEXT
- `ean` TEXT
- `vaasa` INTEGER
- `sweden` INTEGER
- `total` INTEGER
- `source` TEXT
- `imported_at` TIMESTAMPTZ
- PRIMARY KEY (`product_code`, `source`)

#### `categories`
- `id` TEXT PRIMARY KEY
- `code` TEXT
- `description` TEXT
- `language_number` INTEGER

#### `category_hierarchy`
- `id` TEXT PRIMARY KEY
- `prev_category` TEXT
- `category_level` INTEGER

#### `images_staging`
- `product_code` TEXT
- `image_url` TEXT
- `image_name` TEXT
- `imported_at` TIMESTAMPTZ

#### `products`
- `product_code` TEXT PRIMARY KEY
- `name_en` TEXT
- `name_fi` TEXT
- `name_sv` TEXT
- `brand` TEXT
- `category_codes` TEXT[]
- `price_eur_excl_vat` NUMERIC
- `price_eur_incl_vat` NUMERIC
- `stock_total` INTEGER
- `stock_vaasa` INTEGER
- `stock_sweden` INTEGER
- `barcode` TEXT
- `vendor_name` TEXT
- `catalog_restriction` TEXT
- `image_url` TEXT
- `imported_at` TIMESTAMPTZ
- `last_synced_at` TIMESTAMPTZ
- `status` TEXT

#### `ecwid_sync_logs`
- `product_code` TEXT
- `ecwid_item_id` TEXT
- `synced_at` TIMESTAMPTZ
- `status` TEXT
- `message` TEXT
- PRIMARY KEY (`product_code`, `synced_at`)

## Pipeline Flow

### Step 1: Fetch latest FTP files
- Connect to the FTP server.
- Locate `/Data/Products/` and download the latest `products*.csv` file.
- Download `Retail_pricelist.csv`, `ic_CSV.csv`, `ic_ean_CSV.csv`, `product_category_descriptions.csv`, `product_category_hierarchy.csv`, and `product_images.csv`.
- Persist raw file contents to a temporary working directory.

### Step 2: Parse source files
- Parse `products.csv` into product records.
- Parse `Retail_pricelist.csv` into price records.
- Parse `ic_CSV.csv` and `ic_ean_CSV.csv` into stock records.
- Parse category description and hierarchy files.
- Parse `product_images.csv` for image metadata.

### Step 3: Validate and stage data
- Validate `product_code` exists and is not empty.
- Ensure `product_name_en` or at least one localized name exists.
- Validate numeric fields: prices are non-negative, stock counts are integers >= 0.
- Validate category values are parseable from comma-separated string.
- Validate EAN format optionally if barcode is used.
- Reject or log invalid records; do not promote to production.
- Store validated rows into staging tables with `imported_at` and `raw_hash` for dedup.

### Step 4: Enrich and promote to production
- Join staged products with latest staged price, stock, category, and image data.
- Use `product_code` as the merge key.
- Compute production status: `valid`, `missing_price`, `missing_stock`, or `invalid`.
- Insert or update `products` table transactional, using `product_code` unique key.
- Mark `last_synced_at` null until Ecwid sync completes.

### Step 5: Sync valid products to Ecwid
- For each product in `products` with status `valid`, push to Ecwid.
- Use `product_code` as SKU / external reference in Ecwid.
- Include name, description, price, stock, category, brand, barcode, and image URL.
- On success, update `products.last_synced_at`, insert `ecwid_sync_logs`.
- Retry Ecwid API calls with exponential backoff up to 3 attempts.
- Fail the job if the Ecwid sync stage cannot complete after retries.

## Idempotency and Safety
- Use unique keys on `product_code` in staging and production tables.
- Clear or replace staging data each run to avoid stale raw rows.
- Compare hashes before updating production to skip unchanged records.
- Do not write unvalidated data to production.
- With a daily cron trigger, the container can restart safely and rerun without duplicating records.

## Error handling
- Network failures (FTP or Ecwid) are retried with exponential backoff.
- If critical failures persist, abort the current run and preserve logs.
- Database operations use transactions for staging → production promotion.
- Logs are written to stdout/stderr so Docker logging systems can capture them.

## Recommended project structure
- `src/config/env.ts` — environment variables and config
- `src/config/database.ts` — PostgreSQL pool
- `src/ftp/ftp-client.ts` — FTP download with retry
- `src/parsers/csv-parser.ts` — CSV parsing utilities
- `src/validation/product-validator.ts` — strict field validation
- `src/db/staging.ts` — staging table ingestion
- `src/db/promotion.ts` — final promotion to production
- `src/ecwid/ecwid-client.ts` — Ecwid API wrapper
- `src/ecwid/sync-products.ts` — product sync orchestration
- `src/worker.ts` — main cron-driven entrypoint
- `Dockerfile` — container build
- `docker-compose.yml` — local PostgreSQL and worker setup

## Conclusions
- The current text format is usable and gives enough detail.
- It does not replace the actual CSV data files, but it provides a precise schema and data source map.
- The implementation should use `product_code` as the canonical SKU and join files by that field.
- The service should treat price and stock as separate supporting datasets and merge them into the final validated product feed.
