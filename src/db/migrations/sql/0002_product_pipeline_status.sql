-- Product pipeline trace: one row per product per run, recording where each
-- product was rejected (or that it was promoted). Used to answer
-- "why was product X filtered out?".

CREATE TABLE IF NOT EXISTS product_pipeline_status (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id TEXT NOT NULL,
    product_code TEXT NOT NULL,
    model_code TEXT,
    barcode TEXT,
    vendor_name TEXT,
    name_en TEXT,
    status TEXT NOT NULL CHECK (status IN ('promoted', 'rejected')),
    journey JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_pipeline_status_barcode ON product_pipeline_status (barcode);
CREATE INDEX IF NOT EXISTS idx_product_pipeline_status_product_code ON product_pipeline_status (product_code);
CREATE INDEX IF NOT EXISTS idx_product_pipeline_status_run_id ON product_pipeline_status (run_id);
