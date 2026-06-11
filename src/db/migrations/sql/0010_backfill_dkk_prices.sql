-- Migration 0010
-- Backfill DKK prices for existing product_variants rows.
-- 0009 added the column but existing rows were left NULL because the conversion
-- only runs during promotion. This one-time UPDATE fills them in.

UPDATE product_variants
   SET price_dkk_excl_vat = ROUND(price_eur_excl_vat * 7.47417, 2)
 WHERE price_dkk_excl_vat IS NULL
   AND price_eur_excl_vat IS NOT NULL;
