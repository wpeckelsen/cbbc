# CBBC product pipeline

## What this is

This project is an automated pipeline that:

- Downloads product data from a supplier FTP feed (Duell)
- Cleans and checks the data for completeness
- Selects a limited set of products to publish (to keep the system manageable)
- Stores the selected products in a PostgreSQL database
- Pushes the selected products to an online store (Shopify)

## Why it exists

Supplier product feeds are large and often inconsistent. This pipeline turns that raw data into a smaller, reliable set of products that can be used by downstream systems.

## What goes in

The pipeline pulls multiple CSV files from an FTP server, including:

- Product catalog (products)
- Prices
- Stock levels
- Category descriptions + category hierarchy
- Product images

## What comes out

After a run, the selected products are available in the database as:

- **Product models** (the “main product” concept)
- **Product variants / SKUs** (the sellable items)

In other words:

- A *model* groups together related SKUs.
- A *variant/SKU* is what has its own barcode, price, stock, and image.

## What the pipeline considers “publishable”

A product variant is considered eligible when it has:

- A valid barcode
- A valid EUR price
- Stock available
- An image URL
- A brand and at least one category

The pipeline also drops variants if they conflict with their model (for example: a model where variants disagree on brand/vendor/categories).

## Important limitation (current cap)

To keep the output small during the current phase, the pipeline enforces a hard cap:

- It selects up to **50 product models** per run.
- All valid variants belonging to those selected models are included.

## How often it runs

The worker is designed to run on a schedule (cron). The exact timing is configurable and depends on the deployment.

## Store sync (Shopify)

After the pipeline builds a clean set of models + variants in the database, a separate
step pushes them to a Shopify storefront via the GraphQL Admin API:

- Each **product model** becomes a Shopify **product**; its **variants** are grouped
  underneath it.
- Re-runs **upsert** (create or update) keyed by a deterministic product handle
  (`cbbc-{model_code}`), so prices, stock, and images stay in sync without creating
  duplicates.
- Inventory is written to a single Shopify location.
- Models that are no longer in the promoted set are **deleted** from Shopify.

Run it manually:

```bash
npm run shopify:push:prod
```

A weekly schedule can be enabled by setting `SHOPIFY_PUSH_CRON` (e.g. `0 3 * * 1`
for Monday 03:00); it is disabled by default.

### Pricing / VAT note

Variant prices are converted from EUR to **Danish Kroner** (1 EUR = 7.47417 DKK)
during promotion and pushed **excluding VAT** (`price_dkk_excl_vat`). For totals
to be correct, configure your Shopify store so that prices **do not** include tax
("Settings → Taxes and duties") and let Shopify add VAT at checkout.

### Required configuration

See `.env.example`. Create a Shopify custom app (Settings → Apps → Develop apps)
with scopes: `read_products`, `write_products`, `read_inventory`,
`write_inventory`.

Set in `.env`:

```env
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_SECRET=...
SHOPIFY_API_VERSION=2024-10
```

Then run the one-time OAuth authorization:

```bash
npm run shopify:auth
```

This opens a browser URL, you authorize the app, and the access token is saved
to `.env` automatically. After that, `npm run shopify:push:prod` works.

Optionally set `SHOPIFY_LOCATION_ID` and `SHOPIFY_PUSH_CRON`.

## Where to learn more (technical)

For implementation and architecture details (stack, data flow, tables, filtering/capping logic), see:

- `TECHNICAL_OVERVIEW.md`
