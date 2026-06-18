-- Remove migration history entries from the old 0001-0011 files that no longer
-- exist on disk. These were left behind when migrations were consolidated into
-- 0001_init.sql.

DELETE FROM schema_migrations WHERE filename IN (
    '0001_init_schema.sql',
    '0002_products_business_rules.sql',
    '0003_product_models_variants.sql',
    '0004_product_models_variants_business_rules.sql',
    '0005_products_staging_relaxed_attribute_types.sql',
    '0006_store_sync_generic_and_variant_name.sql',
    '0007_enable_rls_policies.sql',
    '0008_content_hash.sql',
    '0009_dkk_price.sql',
    '0010_drop_products_rls_schema_migrations.sql',
    '0011_drop_rls_policies.sql'
);
