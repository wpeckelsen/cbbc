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

const env = (process.env.ENV || 'dev').trim().toLowerCase();
const isProd = env === 'prod' || env === 'production';

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
    url:
      process.env.DATABASE_PUBLIC_URL ||
      process.env.DATABASE_URL ||
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
    pushCron: process.env.SHOPIFY_PUSH_CRON || '',
    forcePush: parseBooleanEnv(process.env.SHOPIFY_FORCE_PUSH, false),
    /** Max models to push per run. 0 = unlimited. Dev default: 5, prod: unlimited. */
    pushModelLimit: parseInt(process.env.SHOPIFY_PUSH_MODEL_LIMIT || (isProd ? '0' : '5'), 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  cron: {
    schedule: process.env.CRON_SCHEDULE || '0 2 * * *',
  },
  /** Max models to promote in the pipeline. 0 = unlimited. Dev default: 50, prod: unlimited. */
  pipelineModelLimit: parseInt(process.env.PIPELINE_MODEL_LIMIT || (isProd ? '0' : '50'), 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  dev: {
    cleanSlate: parseBooleanEnv(process.env.DEV_CLEAN_SLATE, false),
  },
};
