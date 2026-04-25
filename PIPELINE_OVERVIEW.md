# Pipeline overview (data flow + contracts)

## Goal
This document describes **what data** moves through the pipeline and **where it goes**.
It intentionally avoids deep implementation detail and focuses on:

- **Boundaries** (FTP -> in-memory -> staging -> production -> Ecwid)
- **Shapes** (record types / key fields)
- **Storage contracts** (what tables receive what)
- **Observability hooks** (what gets logged at boundaries when enabled)


## End-to-end flow (high level)

1. **FTP input (CSV files)**
2. **Parsed raw records (in-memory)**
3. **Validated/enriched canonical products (in-memory)**
4. **Capped subset selection (in-memory)**
5. **Staging writes (Supabase tables)**
6. **Promotion to production tables (Supabase tables)**
7. **Ecwid sync payload generation + sync status logging (future / partial)**


## Boundary 1: FTP input

### Source
- **Remote**: FTP server
- **Local**: downloaded into a local cache directory (so subsequent runs can re-use downloaded files)

### Files (conceptually)
- **Products**: base product catalog (one row per product)
- **Prices**: retail pricelist (one row per product, possibly with currency/region variants)
- **Stock (by product code)**: inventory snapshot keyed by supplier product code
- **Stock (by EAN)**: inventory snapshot keyed by EAN
- **Categories**: category metadata/descriptions
- **Category hierarchy**: parent/child relationships between categories
- **Images**: product image URLs keyed by product code

### Contract at this boundary
- The pipeline assumes **CSV rows are not trustworthy**:
  - Columns can drift (supplier adds/removes/renames)
  - Types are frequently “stringly typed”
  - Missing values can be empty strings


## Boundary 2: Parsed raw records (in-memory)

After download, each CSV is parsed into an **array of records**.
These objects still resemble the supplier feed.

### Parsed datasets
- `products[]`
- `prices[]`
- `stock_product[]`
- `stock_ean[]`
- `categories[]`
- `category_hierarchy[]`
- `images[]`

### What matters here
- **Counts**: how many rows per dataset
- **Keys present**: confirms supplier columns and drift
- **Representative sample row**: helps diagnose format changes

### Observability
When `PIPELINE_DEBUG=1`:
- the pipeline logs a **keys + sample record** snapshot for each parsed dataset.


## Boundary 3: Canonical “validated products” (in-memory)

### Purpose
Convert “raw supplier product rows” into a **canonical product model** used by the rest of the pipeline.

### Inputs
For each product row, the pipeline attempts to attach related records:
- **price row** (matched by product code)
- **stock row** (matched by product code)
- **image row** (matched by product code)

### Output
- `validatedProducts[]`

These represent the “best effort” canonical product objects: base fields + attached/derived fields + validation outcomes.

### What matters here
- **Data completeness**: does a product actually have price/stock/image coverage?
- **Validation results**: which products fail and why

### Observability
When `PIPELINE_DEBUG=1`:
- the pipeline logs a boundary snapshot of `validatedProducts`.


## Boundary 4: Filtering + cap selection (in-memory)

### Purpose
Reduce the dataset to a manageable subset (MVP cap) while keeping the run meaningful.

### Steps
- **Filtering**: drop products that don’t meet chosen criteria (e.g., invalid, missing required fields)
- **Cap selection**: pick up to `MVP_PRODUCT_LIMIT` products for this run

### What matters here
- **Filter stats**: pass/fail counts + reasons
- **Cap quality**: whether the selected products exercise downstream paths (prices, stock, images)

### Key invariant (pipeline robustness)
Downstream writes are only exercised if the capped set includes products that actually have related records.


## Boundary 5: Staging tables (Supabase)

### Purpose
Staging tables store “raw-ish” pipeline inputs in a structured DB schema.
They’re useful for:
- Debugging
- Auditing
- Repeatable transformations
- Separating ingestion from production promotion

### Tables written
- `products_staging`
- `prices_staging`
- `stock_staging`
- `images_staging`
- `categories`
- `category_hierarchy`

### Contracts / constraints
- **Whitelist for `products_staging`**:
  - The pipeline constructs a `ProductsStagingRow` and only sends allowed columns.
  - This is the “hand-maintained data contract” for staging.

- **Schema preflight for Supabase writes** (all tables):
  - Before insert/upsert, the pipeline introspects the DB schema.
  - If records contain unknown keys, it **logs + drops** those keys.
  - This avoids recurring “column not found” failures caused by drift.

- **Data types**:
  - The pipeline normalizes certain values before staging (notably stock integers).

### Observability
When `PIPELINE_DEBUG=1`:
- the pipeline logs `pre-staging:*` boundary samples before each staging write.


## Boundary 6: Production tables (Supabase)

### Purpose
Production tables represent the “canonical, queryable, serving-ready” version of products.

### Table written
- `products`

### Input
- The capped subset of validated products is mapped into the production write model.

### Observability
When `PIPELINE_DEBUG=1`:
- the pipeline logs `pre-prod:products` boundary samples.


## Boundary 7: Ecwid (future target)

### Purpose
Ecwid is the external commerce system that will eventually receive updates.

### Data that will flow to Ecwid
Conceptually, the pipeline will generate an **Ecwid payload** per product containing:
- Core product identity (SKU / product code, name)
- Pricing (incl. rules/currency if applicable)
- Stock/availability
- Categories mappings
- Images
- Any additional fields required by Ecwid (attributes, descriptions, etc.)

### Sync logging
- The pipeline already anticipates logging sync attempts/results to `ecwid_sync_logs`.

### Observability
When `PIPELINE_DEBUG=1`:
- the pipeline logs a `pre-ecwid:products` boundary sample (keys + sample record).


## Data contracts summary (what to rely on)

### Stable contracts (pipeline-owned)
- **Staging write shape** for `products_staging`: enforced by a TS allowlist
- **DB schema compatibility**: enforced by schema preflight (log + drop unknown keys)
- **Boundary observability**: consistent debug logs at parse/validate/stage/prod/ecwid boundaries

### Unstable contracts (supplier-owned)
- FTP CSV columns and types can change without notice.


## “Where to look” when deciding what fields are essential

If you want to decide “what fields we really want in” (especially for production + Ecwid), the most reliable scan points are:

- **DB schema**:
  - staging table definitions: what you *intend to store from the supplier*
  - production table definitions: what you *intend to serve/use downstream*

- **Validator / canonical model**:
  - what fields are produced/required by validation and enrichment

- **Ecwid mapping layer (when implemented)**:
  - the exact fields needed to build a valid Ecwid product update payload


## Practical invariant checks (sanity)

A healthy run should generally show:

- Non-zero counts at `post-parse:*` for the main datasets
- Non-zero `post-validate:validated_products`
- Non-zero `pre-staging:products_staging`
- And (when cap selection is working as intended) non-zero:
  - `pre-staging:prices_staging`
  - `pre-staging:stock_staging:*`
  - `pre-staging:images_staging`

If any of those are consistently zero, it usually means:
- the corresponding CSV wasn’t downloaded/parsed
- join keys don’t match (e.g., different product codes)
- cap selection filtered out coverage
