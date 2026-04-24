import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  ftp: {
    host: process.env.FTP_HOST || 'ftp.example.com',
    port: parseInt(process.env.FTP_PORT || '21'),
    user: process.env.FTP_USER || '',
    pass: process.env.FTP_PASS || '',
    secure: process.env.FTP_SECURE === 'true',
  },
  database: {
    url: process.env.DATABASE_URL || '',
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
};
