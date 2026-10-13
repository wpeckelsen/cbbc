-- ============================================================================
-- Simplify pricing: only the supplier's DKK incl. VAT price is kept.
--
-- EUR, SEK, NOK, GBP, and DKK excl. VAT prices are no longer needed. Drop them
-- from both the production `product_variants` table and the `prices_staging`
-- staging table. `price_dkk_incl_vat` (added in 0005) is now the single source
-- of truth for the storefront price.
-- ============================================================================

-- product_variants: drop the EUR price columns and their CHECK constraints,
-- plus the now-unused DKK excl. VAT column.
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_price_incl_gte_excl;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_price_non_negative;
ALTER TABLE product_variants DROP COLUMN IF EXISTS price_eur_excl_vat;
ALTER TABLE product_variants DROP COLUMN IF EXISTS price_eur_incl_vat;
ALTER TABLE product_variants DROP COLUMN IF EXISTS price_dkk_excl_vat;

-- prices_staging: drop all non-DKK currency columns and DKK excl. VAT.
ALTER TABLE prices_staging DROP COLUMN IF EXISTS eur_excl_vat;
ALTER TABLE prices_staging DROP COLUMN IF EXISTS eur_incl_vat;
ALTER TABLE prices_staging DROP COLUMN IF EXISTS eur_excl_vat_eu;
ALTER TABLE prices_staging DROP COLUMN IF EXISTS eur_incl_vat_eu;
ALTER TABLE prices_staging DROP COLUMN IF EXISTS sek_excl_vat;
ALTER TABLE prices_staging DROP COLUMN IF EXISTS sek_incl_vat;
ALTER TABLE prices_staging DROP COLUMN IF EXISTS nok_excl_vat;
ALTER TABLE prices_staging DROP COLUMN IF EXISTS nok_incl_vat;
ALTER TABLE prices_staging DROP COLUMN IF EXISTS gbp_excl_vat;
ALTER TABLE prices_staging DROP COLUMN IF EXISTS dkk_excl_vat;
