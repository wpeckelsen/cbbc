-- Migration 0008
-- Add content-hash columns to store_product_links so the Shopify push can skip
-- models whose payload has not changed since the last successful sync.
--
-- Two separate hashes allow an inventory-only fast path: when only stock levels
-- changed, the push can skip the expensive productSet mutation and only call
-- inventorySetQuantities.

ALTER TABLE store_product_links
  ADD COLUMN IF NOT EXISTS last_pushed_product_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_pushed_stock_hash TEXT;
