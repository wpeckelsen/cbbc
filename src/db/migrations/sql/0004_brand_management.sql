-- ============================================================================
-- Brand management: editable whitelist, supplier brand catalogue, audit log.
--
-- The brand whitelist moves from the static `brands.md` file into the database
-- so it can be edited from the frontend. `brand_catalog` holds every distinct
-- brand seen in the supplier feed (the FTP feed is the source of truth) and is
-- refreshed by the pipeline each run. `brand_whitelist_events` is an
-- append-only audit log of add/remove actions.
--
-- Brand identity is the `brand_key`: a canonical, lowercased form with
-- underscores converted to spaces and whitespace collapsed, so spellings that
-- differ only in case/underscores/whitespace collapse to the same brand.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- All distinct brands present in the supplier feed (refreshed each run).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_catalog (
    brand_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- Whitelisted brands: the brands the pipeline is allowed to process.
-- Empty table = "allow all brands".
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_whitelist (
    brand_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Append-only audit log of add/remove actions on the whitelist.
-- Rows are never updated or deleted; a brand can therefore be added, removed,
-- and re-added with each action preserved. `display_name` is a snapshot taken
-- at action time so history remains readable even after a supplier rename.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_whitelist_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    brand_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
    actor TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_whitelist_events_brand_key ON brand_whitelist_events (brand_key);
CREATE INDEX IF NOT EXISTS idx_brand_whitelist_events_created_at ON brand_whitelist_events (created_at);

-- ----------------------------------------------------------------------------
-- Seed the whitelist from the current brands.md content. This is a one-time
-- migration of existing state; afterwards the database table is authoritative
-- and brands.md is no longer read.
-- ----------------------------------------------------------------------------
INSERT INTO brand_whitelist (brand_key, display_name) VALUES
    ('schuberth', 'Schuberth'),
    ('scorpion', 'Scorpion'),
    ('airoh', 'airoh'),
    ('leatt', 'Leatt'),
    ('interphone', 'Interphone'),
    ('sena', 'SENA'),
    ('halvarssons', 'Halvarssons'),
    ('lindstrands', 'Lindstrands'),
    ('alpinestars', 'Alpinestars'),
    ('sixy5', 'Sixy5'),
    ('oc1', 'OC1'),
    ('castrol', 'castrol'),
    ('ipone', 'Ipone'),
    ('repsol', 'Repsol'),
    ('silkolene', 'Silkolene'),
    ('belray', 'Belray'),
    ('k&n', 'K&N'),
    ('hyper', 'Hyper'),
    ('6d', '6D'),
    ('simpson', 'Simpson'),
    ('amoq', 'Amoq'),
    ('apex', 'Apex'),
    ('snowpeople', 'SnowPeople'),
    ('forma', 'Forma'),
    ('pmj', 'PMJ'),
    ('spect', 'SPECT'),
    ('sidi', 'Sidi'),
    ('visiodry', 'Visiodry'),
    ('pinlock', 'PINLOCK'),
    ('akrapovic', 'Akrapovic'),
    ('axp racing', 'AXP Racing'),
    ('hgs', 'HGS'),
    ('hiflo', 'HiFlo'),
    ('yoshimura', 'Yoshimura'),
    ('buff', 'Buff'),
    ('woolpower', 'Woolpower'),
    ('bowtex', 'Bowtex'),
    ('pirelli', 'Pirelli'),
    ('dunlop', 'Dunlop'),
    ('metzler', 'Metzler'),
    ('michelin', 'Michelin'),
    ('bike-lift', 'Bike-Lift'),
    ('tuff jug', 'Tuff Jug'),
    ('polyver', 'Polyver'),
    ('yakk exp', 'Yakk Exp'),
    ('x 1r', 'x 1r'),
    ('optiline lampa', 'Optiline Lampa'),
    ('star brite', 'Star Brite'),
    ('metzeler', 'Metzeler')
ON CONFLICT (brand_key) DO NOTHING;
