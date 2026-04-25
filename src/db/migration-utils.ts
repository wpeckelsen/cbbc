import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { config } from '../config/env';

export const MIGRATIONS_TABLE = 'schema_migrations';

export function getDatabaseUrl(): string {
  const url =
    config.database.url ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.SUPABASE_DATABASE_URL ||
    process.env.SUPABASE_POSTGRES_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DIRECT_URL ||
    process.env.SUPABASE_CONNECTION_STRING ||
    process.env.SUPABASE_DB_CONNECTION_STRING ||
    '';
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  return url;
}

export function getMigrationsDir(): string {
  return path.join(__dirname, 'migrations', 'sql');
}

export function listMigrationFiles(): string[] {
  const dir = getMigrationsDir();
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

export function readMigrationSql(filename: string): string {
  const fullPath = path.join(getMigrationsDir(), filename);
  return fs.readFileSync(fullPath, 'utf8');
}

export async function createClient(): Promise<Client> {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  return client;
}

export async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (\n` +
      `  filename TEXT PRIMARY KEY,\n` +
      `  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n` +
      `);`
  );
}

export async function getAppliedMigrations(client: Client): Promise<Set<string>> {
  await ensureMigrationsTable(client);
  const res = await client.query(
    `SELECT filename FROM ${MIGRATIONS_TABLE} ORDER BY filename ASC;`
  );
  const rows = res.rows as Array<{ filename: string }>;
  return new Set(rows.map((r) => r.filename));
}
