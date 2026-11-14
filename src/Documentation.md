# CBBC: Simple Guide

This service takes product data from the supplier (Duell), selects the products we want to sell, saves them in PostgreSQL, and sends them to Shopify.

## Latest update: adjustable prices (including 5% off)

Prices can now be adjusted with one environment variable:

```env
PRICE_MULTIPLIER=0.95
```

- `1` = no change (the default).
- `0.95` = reduce every price by 5%.
- Example: a supplier price of DKK 100.00 incl. VAT becomes DKK 95.00 incl. VAT.
- Adjusted prices are rounded to 2 decimals.

### Where the adjustment happens

The multiplier is applied once while supplier data is enriched, in `src/validation/product-validator.ts`. The adjusted value is then stored in `product_variants.price_dkk_incl_vat` and pushed to Shopify. There is no second adjustment in Shopify.

The original supplier price is still available in `prices_staging.dkk_incl_vat`.

### How to apply or revert it

1. Set `PRICE_MULTIPLIER` in `.env` locally, or in the Railway service variables in production.
2. Run the normal full pipeline (`npm run dev` locally, or the scheduled worker in production). Do **not** run only `shopify:push:prod`: that reads existing database prices and will not recalculate them.
3. To revert, set `PRICE_MULTIPLIER=1` (or remove the variable) and run the full pipeline again.

No database migration is needed. After a multiplier change, Shopify's content-hash check sees the new prices and updates the affected products. A full-catalogue price change can therefore make the next push take longer.

## Where the brand whitelist lives

The active whitelist is the **`brand_whitelist` table in PostgreSQL**. The pipeline reads this table at the start of each run.

- `brand_whitelist`: brands allowed into the pipeline.
- `brand_catalog`: every brand currently found in the supplier feed; refreshed each run.
- `brands.md`: the old seed list only. Migration `0004_brand_management.sql` copied it into the database once. **Editing `brands.md` now has no effect.**

Brand matching ignores case, treats underscores as spaces, and collapses repeated whitespace. For example, `Yakk_Exp` and `Yakk Exp` match the same whitelist key.

An empty `brand_whitelist` table means **allow all brands**. In production the brand filter is always enabled. In development, `BRAND_FILTER_ENABLED` controls whether it runs.

## General pipeline workings

A normal run does the following, in order:

1. **Download supplier files** — six CSV files are downloaded from Duell's FTP server: products, prices, stock, categories, category hierarchy, and images.
2. **Read the product feed** — the product CSV is parsed first.
3. **Refresh brands and apply the whitelist** — `brand_catalog` is updated, then products outside `brand_whitelist` are removed before further processing.
4. **Join product data** — each product is matched with its price, stock, and images. The optional `PRICE_MULTIPLIER` is applied here.
5. **Validate and filter** — products need usable data such as a barcode, positive price, stock, image, brand, and categories. Parent/model rows and sellable variants are handled separately.
6. **Apply development limits if configured** — development can cap the number of models; production is unlimited.
7. **Save to staging, then production** — selected data is written to staging tables and promoted to `product_models` and `product_variants`. Stale production records are cleaned up during unlimited runs.
8. **Push to Shopify** — models become Shopify products and variants become SKUs. Prices and inventory are synchronized. Unchanged products are skipped using content hashes; products no longer in the promoted catalogue are removed from Shopify.

The worker runs these steps once and exits. Railway Cron runs it on a schedule in production.

## Useful commands

```bash
npm run dev        # Full pipeline + Shopify push for development
npm run build      # Compile TypeScript
npm start          # Full production run, once
npm run db:migrate # Apply database migrations when setting up/upgrading the DB
```

For all environment variables, see `.env.example`.
