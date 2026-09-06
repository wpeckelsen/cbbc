import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

function parseBooleanEnv(value: string | undefined, defaultValue: boolean = false): boolean {
  if (value === undefined) return defaultValue;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
  return defaultValue;
}

// ENV is required and must be exactly 'dev' or 'prod' — no silent default.
const rawEnv = (process.env.ENV || '').trim().toLowerCase();
if (rawEnv !== 'dev' && rawEnv !== 'prod') {
  throw new Error(
    `ENV must be set to 'dev' or 'prod' (got '${process.env.ENV || ''}'). Refusing to start without an explicit environment.`,
  );
}
const isProd = rawEnv === 'prod';

/** Required in dev (no default); prod ignores these and is always unlimited. */
function requireNonNegativeInt(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(`${name} must be set when ENV=dev (use 0 for unlimited).`);
  }
  const value = parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (got '${raw}').`);
  }
  return value;
}

/** Required boolean in dev (no default). Prod never calls this. */
function requireBoolean(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(`${name} must be set when ENV=dev (true or false).`);
  }
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
  throw new Error(`${name} must be true or false (got '${raw}').`);
}

export const config = {
  /** 'dev' or 'prod' — controls caps, caching, and safety rails. */
  env: isProd ? 'prod' as const : 'dev' as const,
  isProd,
  ftp: {
    host: process.env.FTP_HOST || 'ftp.example.com',
    port: parseInt(process.env.FTP_PORT || '21'),
    user: process.env.FTP_USER || '',
    pass: process.env.FTP_PASS || '',
    secure: process.env.FTP_SECURE === 'true',
    rejectUnauthorized: parseBooleanEnv(process.env.FTP_REJECT_UNAUTHORIZED, true),
    /** In prod, cache is cleared each run to ensure fresh data. In dev, cache persists. */
    useCache: !isProd,
    verbose: !isProd,
  },
  database: {
    // Dev (local): use the public TCP proxy URL for external access.
    // Prod (Railway): use the internal URL for fast, free connections.
    url:
      (isProd
        ? (process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL)
        : (process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL)
      ) ||
      process.env.POSTGRES_URL ||
      '',
  },
  shopify: {
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN || '',
    clientId: process.env.SHOPIFY_CLIENT_ID || '',
    secret: process.env.SHOPIFY_SECRET || '',
    adminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2024-10',
    locationId: process.env.SHOPIFY_LOCATION_ID || '',
    publicationId: process.env.SHOPIFY_PUBLICATION_ID || '',
    /** Max models to push per run. Dev: required. Prod: always unlimited (0). */
    pushModelLimit: isProd ? 0 : requireNonNegativeInt('SHOPIFY_PUSH_MODEL_LIMIT'),
  },
  logging: {
    /** Fixed: debug in dev, info in prod. */
    level: isProd ? 'info' : 'debug',
  },
  /** Max models to promote in the pipeline. Dev: required. Prod: always unlimited (0). */
  pipelineModelLimit: isProd ? 0 : requireNonNegativeInt('PIPELINE_MODEL_LIMIT'),
  /**
   * Brand pre-filter: when enabled, only products whose vendor_name matches
   * the whitelist in brands.md are processed. Prod: always on. Dev: required
   * (true/false). An empty brands.md is treated as "allow all brands".
   */
  brandFilterEnabled: isProd ? true : requireBoolean('BRAND_FILTER_ENABLED'),
};