-- Migration 0010
-- 1) Drop the legacy "products" table (superseded by product_models + product_variants).
-- 2) Enable RLS on schema_migrations and lock it down (service_role only).

-- ============================================================================
-- 1) Drop the products table
-- ============================================================================

DROP TABLE IF EXISTS products;

-- ============================================================================
-- 2) Enable RLS on schema_migrations
-- ============================================================================

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- No policies are created for anon/authenticated, which means only
-- service_role (which bypasses RLS) can read or write this table.
