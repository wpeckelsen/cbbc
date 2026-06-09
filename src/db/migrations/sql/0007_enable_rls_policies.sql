-- Migration 0007
-- Enable Row Level Security on all public tables and add appropriate policies.
--
-- Access model:
--   service_role  → bypasses RLS (implicit in Supabase), used by the pipeline worker
--   anon/authenticated → read-only on public catalogue + reference data; no access elsewhere

-- ============================================================================
-- 1) Enable RLS on every table
-- ============================================================================

ALTER TABLE products_staging      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices_staging        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_staging         ENABLE ROW LEVEL SECURITY;
ALTER TABLE images_staging        ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_hierarchy    ENABLE ROW LEVEL SECURITY;
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_models        ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_sync_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_product_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_variant_links   ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2) Public catalogue — read-only for anon & authenticated
-- ============================================================================

CREATE POLICY "Allow public read on product_models"
  ON product_models FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public read on product_variants"
  ON product_variants FOR SELECT
  TO anon, authenticated
  USING (true);

-- ============================================================================
-- 3) Reference data — read-only for anon & authenticated
-- ============================================================================

CREATE POLICY "Allow public read on categories"
  ON categories FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public read on category_hierarchy"
  ON category_hierarchy FOR SELECT
  TO anon, authenticated
  USING (true);

-- ============================================================================
-- 4) Everything else: no policies for anon/authenticated = fully locked down.
--    Tables with RLS enabled and no matching policy deny all access by default.
--    (products_staging, prices_staging, stock_staging, images_staging,
--     products, store_sync_logs, store_product_links, store_variant_links)
-- ============================================================================
