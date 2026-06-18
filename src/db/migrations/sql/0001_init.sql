-- Consolidated schema for the CBBC product pipeline.
-- Produces the same final state as the former migrations 0001-0011.

-- ============================================================================
-- Staging tables (raw supplier data)
-- ============================================================================

CREATE TABLE IF NOT EXISTS products_staging (
    product_code TEXT PRIMARY KEY,
    categories TEXT,
    family TEXT,
    parent TEXT,
    one_variant BOOLEAN,
    customs_pos TEXT,
    product_model_name_en TEXT,
    product_model_name_fi TEXT,
    product_model_name_sv TEXT,
    vendor_name TEXT,
    country_origin TEXT,
    vak_code TEXT,
    yk_no TEXT,
    supplier_product_code TEXT,
    catalog_restriction TEXT,
    material TEXT,
    make_model TEXT,
    brand TEXT,
    short_description_en TEXT,
    short_description_fi TEXT,
    short_description_sv TEXT,
    long_description_en TEXT,
    long_description_fi TEXT,
    long_description_sv TEXT,
    product_name_en TEXT,
    product_name_fi TEXT,
    product_name_sv TEXT,
    barcode TEXT,
    compound TEXT,
    lug_height TEXT,
    lug_height_unit TEXT,
    oem_number TEXT,
    tyre_studs TEXT,
    tyre_ply_rating TEXT,
    waterproof TEXT,
    foldable TEXT,
    bolt_pattern TEXT,
    top_hole_diameter TEXT,
    top_hole_diameter_unit TEXT,
    top_eyelet_width TEXT,
    top_eyelet_width_unit TEXT,
    bottom_hole_diameter TEXT,
    bottom_hole_diameter_unit TEXT,
    bottom_eyelet_width TEXT,
    bottom_eyelet_width_unit TEXT,
    construction TEXT,
    intercom_range TEXT,
    bulb_base TEXT,
    resistor TEXT,
    handlebar_clamp_diameter TEXT,
    handlebar_clamp_diameter_unit TEXT,
    front_rear_tyre TEXT,
    mounting_kit_included TEXT,
    winch_max_capacity TEXT,
    winch_max_capacity_unit TEXT,
    tyre_weight_index TEXT,
    tyre_speed_rating TEXT,
    power_light TEXT,
    power_light_unit TEXT,
    helmet_safety_system TEXT,
    studs_count TEXT,
    valve_type TEXT,
    valve_length TEXT,
    valve_length_unit TEXT,
    bicycle_brake_type TEXT,
    handlebar_rise TEXT,
    handlebar_rise_unit TEXT,
    buoyancy TEXT,
    buoyancy_unit TEXT,
    bicycle_brake_model TEXT,
    bicycle_wheel_hub TEXT,
    clothing_size TEXT,
    gender TEXT,
    has_membrane TEXT,
    package_weight TEXT,
    package_weight_unit TEXT,
    package_height TEXT,
    package_height_unit TEXT,
    package_width TEXT,
    package_width_unit TEXT,
    package_length TEXT,
    package_length_unit TEXT,
    packing_size TEXT,
    certifications TEXT,
    size TEXT,
    tyre_rim_size TEXT,
    tyre_rim_size_unit TEXT,
    tyre_height TEXT,
    tyre_height_unit TEXT,
    tyre_width TEXT,
    tyre_width_unit TEXT,
    max_load TEXT,
    max_load_unit TEXT,
    etrto_size TEXT,
    track_length TEXT,
    track_length_unit TEXT,
    track_width TEXT,
    track_width_unit TEXT,
    track_pitch TEXT,
    track_pitch_unit TEXT,
    rim_width TEXT,
    rim_width_unit TEXT,
    cc_max TEXT,
    cc_max_unit TEXT,
    cc_min TEXT,
    cc_min_unit TEXT,
    spokes_length TEXT,
    spokes_length_unit TEXT,
    product_weight TEXT,
    product_weight_unit TEXT,
    product_height TEXT,
    product_height_unit TEXT,
    product_width TEXT,
    product_width_unit TEXT,
    product_length TEXT,
    product_length_unit TEXT,
    sparkplug_thread_length TEXT,
    thickness TEXT,
    thickness_unit TEXT,
    diameter TEXT,
    diameter_unit TEXT,
    inner_diameter TEXT,
    inner_diameter_unit TEXT,
    outer_diameter TEXT,
    outer_diameter_unit TEXT,
    riser_height TEXT,
    riser_height_unit TEXT,
    oil_type TEXT,
    oil_viscosity TEXT,
    oil_volume TEXT,
    oil_volume_unit TEXT,
    oil_stroke TEXT,
    sprocket_front TEXT,
    sprocket_rear TEXT,
    drive_chain_pitch TEXT,
    chain_links TEXT,
    sprocket_internal_splines TEXT,
    chain_guard TEXT,
    drive_chain_lock_type TEXT,
    drive_chain_seal_type TEXT,
    drive_pitch TEXT,
    lens_colour TEXT,
    touch_screen_compatible TEXT,
    sparkplug_seat_configuration TEXT,
    silencer_fitment TEXT,
    teeth_count TEXT,
    pre_drilled TEXT,
    clamp_on TEXT,
    sunvisor TEXT,
    sparkplug_heat_rating TEXT,
    volume TEXT,
    volume_unit TEXT,
    colour_en TEXT,
    colour_fi TEXT,
    colour_sv TEXT,
    colour_property_en TEXT,
    colour_property_fi TEXT,
    colour_property_sv TEXT,
    derailleur_gears_speed TEXT,
    bag_type TEXT,
    lens_type TEXT,
    battery_type TEXT,
    filter_type TEXT,
    track_type TEXT,
    bulb_type TEXT,
    transmission_type TEXT,
    jet_type TEXT,
    suspension TEXT,
    riding_style TEXT,
    adjustability_type TEXT,
    helmet_type TEXT,
    lever_type TEXT,
    light_part_type TEXT,
    silencer_type TEXT,
    cable_type TEXT,
    bearing_kit_type TEXT,
    lifejacket_type TEXT,
    battery_cca TEXT,
    battery_cca_unit TEXT,
    battery_capacity TEXT,
    "battery_capacity-unit" TEXT,
    category_codes TEXT[],
    created TIMESTAMPTZ,
    updated TIMESTAMPTZ,
    raw_hash TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prices_staging (
    product_code TEXT PRIMARY KEY,
    eur_excl_vat NUMERIC,
    eur_incl_vat NUMERIC,
    eur_excl_vat_eu NUMERIC,
    eur_incl_vat_eu NUMERIC,
    sek_excl_vat NUMERIC,
    sek_incl_vat NUMERIC,
    nok_excl_vat NUMERIC,
    nok_incl_vat NUMERIC,
    gbp_excl_vat NUMERIC,
    dkk_excl_vat NUMERIC,
    dkk_incl_vat NUMERIC,
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_staging (
    product_code TEXT,
    ean TEXT,
    vaasa INTEGER,
    sweden INTEGER,
    total INTEGER,
    source TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (product_code, source)
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    code TEXT,
    description TEXT,
    language_number INTEGER
);

CREATE TABLE IF NOT EXISTS category_hierarchy (
    id TEXT PRIMARY KEY,
    prev_category TEXT,
    category_level INTEGER
);

CREATE TABLE IF NOT EXISTS images_staging (
    product_code TEXT,
    image_url TEXT,
    image_name TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Production tables
-- ============================================================================

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
    last_synced_at TIMESTAMPTZ,

    CONSTRAINT product_models_category_codes_non_empty
        CHECK (array_length(category_codes, 1) > 0)
);

CREATE TABLE IF NOT EXISTS product_variants (
    product_code TEXT PRIMARY KEY,
    model_code TEXT NOT NULL REFERENCES product_models(model_code) ON DELETE CASCADE,
    name_en TEXT NOT NULL,
    barcode TEXT NOT NULL,
    price_eur_excl_vat NUMERIC NOT NULL,
    price_eur_incl_vat NUMERIC NOT NULL,
    price_dkk_excl_vat NUMERIC,
    stock_total INTEGER NOT NULL,
    stock_vaasa INTEGER,
    stock_sweden INTEGER,
    image_url TEXT NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ,

    CONSTRAINT product_variants_price_non_negative
        CHECK (price_eur_excl_vat >= 0 AND price_eur_incl_vat >= 0),
    CONSTRAINT product_variants_price_incl_gte_excl
        CHECK (price_eur_incl_vat >= price_eur_excl_vat),
    CONSTRAINT product_variants_stock_total_non_negative
        CHECK (stock_total >= 0),
    CONSTRAINT product_variants_stock_vaasa_non_negative
        CHECK (stock_vaasa IS NULL OR stock_vaasa >= 0),
    CONSTRAINT product_variants_stock_sweden_non_negative
        CHECK (stock_sweden IS NULL OR stock_sweden >= 0),
    CONSTRAINT product_variants_barcode_numeric
        CHECK (barcode ~ '^[0-9]+$'),
    CONSTRAINT product_variants_image_url_http
        CHECK (image_url ~* '^https?://')
);

CREATE INDEX IF NOT EXISTS idx_product_variants_model_code ON product_variants (model_code);

-- ============================================================================
-- Storefront sync bookkeeping (store-agnostic)
-- ============================================================================

CREATE TABLE IF NOT EXISTS store_sync_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scope TEXT NOT NULL,
    local_code TEXT NOT NULL,
    external_id TEXT,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_sync_logs_synced_at ON store_sync_logs (synced_at);
CREATE INDEX IF NOT EXISTS idx_store_sync_logs_local_code ON store_sync_logs (local_code);

CREATE TABLE IF NOT EXISTS store_product_links (
    model_code TEXT PRIMARY KEY,
    external_product_id TEXT NOT NULL,
    external_handle TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_pushed_product_hash TEXT,
    last_pushed_stock_hash TEXT
);

CREATE TABLE IF NOT EXISTS store_variant_links (
    product_code TEXT PRIMARY KEY,
    model_code TEXT NOT NULL,
    external_variant_id TEXT NOT NULL,
    external_inventory_item_id TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_variant_links_model_code ON store_variant_links (model_code);

-- ============================================================================
-- Staging indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_products_staging_imported_at ON products_staging (imported_at);
CREATE INDEX IF NOT EXISTS idx_prices_staging_imported_at ON prices_staging (imported_at);
CREATE INDEX IF NOT EXISTS idx_stock_staging_imported_at ON stock_staging (imported_at);
CREATE INDEX IF NOT EXISTS idx_images_staging_imported_at ON images_staging (imported_at);
