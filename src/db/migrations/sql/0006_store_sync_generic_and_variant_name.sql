-- Migration 0006
-- 1) Add a per-variant English name to production variants. This is the source
--    for the Shopify variant option value (e.g. "Sena Helmet Phantom White, S").
-- 2) Replace the Ecwid-specific bookkeeping with store-agnostic tables so the
--    storefront integration (currently Shopify) can be swapped without DB churn.

-- --- 1) Variant name -------------------------------------------------------

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS name_en TEXT;

-- Backfill any pre-existing variant rows from their model's English name so the
-- NOT NULL constraint below can be applied safely.
UPDATE product_variants v
SET name_en = m.name_en
FROM product_models m
WHERE v.model_code = m.model_code
  AND (v.name_en IS NULL OR v.name_en = '');

-- Any remaining nulls (orphan variants without a model) get a deterministic
-- fallback so the constraint can be enforced.
UPDATE product_variants
SET name_en = product_code
WHERE name_en IS NULL OR name_en = '';

ALTER TABLE product_variants
  ALTER COLUMN name_en SET NOT NULL;

-- --- 2) Store-agnostic bookkeeping -----------------------------------------

-- Drop the Ecwid-specific log table; replaced by store_sync_logs below.
DROP TABLE IF EXISTS ecwid_sync_logs;

-- Append-only audit log of storefront sync actions.
CREATE TABLE IF NOT EXISTS store_sync_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scope TEXT NOT NULL,        -- 'product' | 'variant'
    local_code TEXT NOT NULL,   -- model_code or product_code
    external_id TEXT,           -- storefront product/variant id
    action TEXT NOT NULL,       -- 'create' | 'update' | 'delete'
    status TEXT NOT NULL,       -- 'success' | 'failed'
    message TEXT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_sync_logs_synced_at ON store_sync_logs (synced_at);
CREATE INDEX IF NOT EXISTS idx_store_sync_logs_local_code ON store_sync_logs (local_code);

-- Mapping of local models -> storefront products. Deliberately NOT
-- foreign-keyed to product_models: reconciliation must retain the external id
-- after a model leaves production so the push can delete it from the storefront.
CREATE TABLE IF NOT EXISTS store_product_links (
    model_code TEXT PRIMARY KEY,
    external_product_id TEXT NOT NULL,
    external_handle TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mapping of local variants -> storefront variants + inventory items.
CREATE TABLE IF NOT EXISTS store_variant_links (
    product_code TEXT PRIMARY KEY,
    model_code TEXT NOT NULL,
    external_variant_id TEXT NOT NULL,
    external_inventory_item_id TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_variant_links_model_code ON store_variant_links (model_code);
