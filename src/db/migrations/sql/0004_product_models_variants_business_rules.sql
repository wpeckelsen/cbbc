ALTER TABLE product_models
  ADD CONSTRAINT product_models_category_codes_non_empty CHECK (array_length(category_codes, 1) > 0);

ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_price_non_negative CHECK (price_eur_excl_vat >= 0 AND price_eur_incl_vat >= 0),
  ADD CONSTRAINT product_variants_price_incl_gte_excl CHECK (price_eur_incl_vat >= price_eur_excl_vat),
  ADD CONSTRAINT product_variants_stock_total_non_negative CHECK (stock_total >= 0),
  ADD CONSTRAINT product_variants_stock_vaasa_non_negative CHECK (stock_vaasa IS NULL OR stock_vaasa >= 0),
  ADD CONSTRAINT product_variants_stock_sweden_non_negative CHECK (stock_sweden IS NULL OR stock_sweden >= 0),
  ADD CONSTRAINT product_variants_barcode_numeric CHECK (barcode ~ '^[0-9]+$'),
  ADD CONSTRAINT product_variants_image_url_http CHECK (image_url ~* '^https?://');
