-- Migration 0011
-- Remove Row Level Security policies and disable RLS on all tables.
--
-- RLS was used for Supabase's PostgREST auth model (anon/authenticated roles).
-- With a direct PostgreSQL connection (e.g. Railway) the pipeline connects as
-- the DB owner, making RLS unnecessary overhead.

-- ============================================================================
-- 1) Drop policies
-- ============================================================================

DROP POLICY IF EXISTS "Allow public read on product_models"   ON product_models;
DROP POLICY IF EXISTS "Allow public read on product_variants"  ON product_variants;
DROP POLICY IF EXISTS "Allow public read on categories"        ON categories;
DROP POLICY IF EXISTS "Allow public read on category_hierarchy" ON category_hierarchy;

-- ============================================================================
-- 2) Disable RLS on all tables
-- ============================================================================

ALTER TABLE products_staging      DISABLE ROW LEVEL SECURITY;
ALTER TABLE prices_staging        DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_staging         DISABLE ROW LEVEL SECURITY;
ALTER TABLE images_staging        DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories            DISABLE ROW LEVEL SECURITY;
ALTER TABLE category_hierarchy    DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_models        DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants      DISABLE ROW LEVEL SECURITY;
ALTER TABLE store_sync_logs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE store_product_links   DISABLE ROW LEVEL SECURITY;
ALTER TABLE store_variant_links   DISABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations     DISABLE ROW LEVEL SECURITY;
