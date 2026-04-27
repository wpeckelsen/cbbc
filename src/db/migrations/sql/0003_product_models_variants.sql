CREATE TABLE IF NOT EXISTS product_models (
    model_code TEXT PRIMARY KEY,
    name_en TEXT NOT NULL,
    name_fi TEXT,
    name_sv TEXT,
    brand TEXT NOT NULL,
    vendor_name TEXT NOT NULL,
    category_codes TEXT[] NOT NULL,
    catalog_restriction TEXT,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS product_variants (
    product_code TEXT PRIMARY KEY,
    model_code TEXT NOT NULL REFERENCES product_models(model_code) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    price_eur_excl_vat NUMERIC NOT NULL,
    price_eur_incl_vat NUMERIC NOT NULL,
    stock_total INTEGER NOT NULL,
    stock_vaasa INTEGER,
    stock_sweden INTEGER,
    image_url TEXT NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_product_variants_model_code ON product_variants (model_code);
