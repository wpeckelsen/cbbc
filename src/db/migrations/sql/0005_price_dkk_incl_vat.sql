-- ============================================================================
-- Price source: use the supplier's DKK incl. VAT price directly.
--
-- The pipeline previously converted EUR excl. VAT -> DKK (rate 7.47417) and
-- pushed prices excluding VAT (Shopify added VAT at checkout). This migration
-- adds a `price_dkk_incl_vat` column to `product_variants` so the storefront
-- price is sourced straight from the supplier's `DKK_INCL_VAT` column with no
-- conversion. Shopify must be configured to treat prices as tax-inclusive.
-- ============================================================================

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price_dkk_incl_vat NUMERIC;

-- Backfill existing promoted variants from the staging price table.
UPDATE product_variants pv
SET price_dkk_incl_vat = ps.dkk_incl_vat
FROM prices_staging ps
WHERE pv.product_code = ps.product_code
  AND ps.dkk_incl_vat IS NOT NULL
  AND pv.price_dkk_incl_vat IS NULL;

-- Non-negative guard.
ALTER TABLE product_variants
    ADD CONSTRAINT product_variants_price_dkk_incl_vat_non_negative
    CHECK (price_dkk_incl_vat IS NULL OR price_dkk_incl_vat >= 0);
