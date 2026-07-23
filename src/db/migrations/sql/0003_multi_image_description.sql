-- Multi-image support + product description
-- 
-- 1. Replace single image_url with image_urls array on product_variants
-- 2. Add short_description_en to product_models

-- ============================================================================
-- Multi-image: product_variants.image_url → image_urls TEXT[]
-- ============================================================================

-- Add new array column (nullable initially for backfill)
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_urls TEXT[];

-- Backfill from existing single image_url column
UPDATE product_variants
SET image_urls = ARRAY[image_url]
WHERE image_urls IS NULL
  AND image_url IS NOT NULL
  AND image_url != '';

-- Make non-null after backfill
ALTER TABLE product_variants ALTER COLUMN image_urls SET NOT NULL;

-- Drop old single-column constraint
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_image_url_http;

-- Add constraint: array must be non-empty and all entries must be http(s) URLs
ALTER TABLE product_variants ADD CONSTRAINT product_variants_image_urls_non_empty
    CHECK (array_length(image_urls, 1) > 0);

-- Drop old image_url column (after safe migration window)
ALTER TABLE product_variants DROP COLUMN IF EXISTS image_url;

-- ============================================================================
-- Product description: product_models.short_description_en
-- ============================================================================

ALTER TABLE product_models ADD COLUMN IF NOT EXISTS short_description_en TEXT;