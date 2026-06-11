-- Migration 0009
-- Add DKK price column to product_variants.
-- The Shopify store sells in Danish Kroner; the source feed provides EUR prices.
-- The pipeline converts EUR → DKK at promotion time and stores the result here.

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS price_dkk_excl_vat NUMERIC;
