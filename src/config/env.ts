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

export const config = {
  ftp: {
    host: process.env.FTP_HOST || 'ftp.example.com',
    port: parseInt(process.env.FTP_PORT || '21'),
    user: process.env.FTP_USER || '',
    pass: process.env.FTP_PASS || '',
    secure: process.env.FTP_SECURE === 'true',
  },
  database: {
    url:
      process.env.DATABASE_URL ||
      process.env.SUPABASE_DB_URL ||
      process.env.SUPABASE_DATABASE_URL ||
      process.env.SUPABASE_POSTGRES_URL ||
      '',
    supabaseUrl: process.env.SUPABASE_API_BASE_URL || '',
    supabaseKey: process.env.SUPABASE_SECRET_KEY || '',
  },
  ecwid: {
    storeId: process.env.ECWID_STORE_ID || '',
    apiToken: process.env.ECWID_SECRET_TOKEN || '',
    apiBaseUrl: process.env.ECWID_API_BASE_URL || '',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  cron: {
    schedule: process.env.CRON_SCHEDULE || '0 2 * * *',
  },
  nodeEnv: process.env.NODE_ENV || 'development',
  dev: {
    cleanSlate: parseBooleanEnv(process.env.DEV_CLEAN_SLATE, false),
  },
};
