-- Enforce business rules for production products table

-- Normalize timestamps (keep existing if present)
UPDATE products
SET imported_at = COALESCE(imported_at, NOW()),
    last_synced_at = COALESCE(last_synced_at, NOW());

-- Remove rows that violate MUST-have rules (they would block NOT NULL / CHECK constraints)
DELETE FROM products
WHERE
  name_en IS NULL OR btrim(name_en) = '' OR
  brand IS NULL OR btrim(brand) = '' OR
  vendor_name IS NULL OR btrim(vendor_name) = '' OR
  barcode IS NULL OR btrim(barcode) = '' OR barcode !~ '^[0-9]+$' OR
  image_url IS NULL OR btrim(image_url) = '' OR image_url !~* '^https?://' OR
  category_codes IS NULL OR array_length(category_codes, 1) IS NULL OR array_length(category_codes, 1) = 0 OR
  price_eur_excl_vat IS NULL OR price_eur_excl_vat < 0 OR
  price_eur_incl_vat IS NULL OR price_eur_incl_vat < 0 OR
  price_eur_incl_vat < price_eur_excl_vat OR
  stock_total IS NULL OR stock_total < 0 OR
  imported_at IS NULL OR
  last_synced_at IS NULL;

-- Enforce NOT NULL constraints
ALTER TABLE products
  ALTER COLUMN name_en SET NOT NULL,
  ALTER COLUMN brand SET NOT NULL,
  ALTER COLUMN category_codes SET NOT NULL,
  ALTER COLUMN price_eur_excl_vat SET NOT NULL,
  ALTER COLUMN price_eur_incl_vat SET NOT NULL,
  ALTER COLUMN stock_total SET NOT NULL,
  ALTER COLUMN barcode SET NOT NULL,
  ALTER COLUMN vendor_name SET NOT NULL,
  ALTER COLUMN image_url SET NOT NULL,
  ALTER COLUMN imported_at SET NOT NULL,
  ALTER COLUMN last_synced_at SET NOT NULL;

-- Defaults for timestamps
ALTER TABLE products
  ALTER COLUMN imported_at SET DEFAULT NOW(),
  ALTER COLUMN last_synced_at SET DEFAULT NOW();

-- CHECK constraints
ALTER TABLE products
  ADD CONSTRAINT products_category_codes_non_empty CHECK (array_length(category_codes, 1) > 0),
  ADD CONSTRAINT products_price_non_negative CHECK (price_eur_excl_vat >= 0 AND price_eur_incl_vat >= 0),
  ADD CONSTRAINT products_price_incl_gte_excl CHECK (price_eur_incl_vat >= price_eur_excl_vat),
  ADD CONSTRAINT products_stock_total_non_negative CHECK (stock_total >= 0),
  ADD CONSTRAINT products_stock_vaasa_non_negative CHECK (stock_vaasa IS NULL OR stock_vaasa >= 0),
  ADD CONSTRAINT products_stock_sweden_non_negative CHECK (stock_sweden IS NULL OR stock_sweden >= 0),
  ADD CONSTRAINT products_barcode_numeric CHECK (barcode ~ '^[0-9]+$'),
  ADD CONSTRAINT products_image_url_http CHECK (image_url ~* '^https?://');
