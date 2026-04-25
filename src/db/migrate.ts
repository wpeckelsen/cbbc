import { logger } from '../logger';
import {
  createClient,
  ensureMigrationsTable,
  getAppliedMigrations,
  listMigrationFiles,
  readMigrationSql,
  MIGRATIONS_TABLE,
} from './migration-utils';

export async function runMigrations(): Promise<void> {
  const client = await createClient();

  try {
    await ensureMigrationsTable(client);

    const applied = await getAppliedMigrations(client);
    const files = listMigrationFiles();

    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      logger.info('No pending migrations');
      return;
    }

    logger.info({ pending }, `Applying ${pending.length} migrations`);

    for (const filename of pending) {
      const sql = readMigrationSql(filename);

      logger.info(`Applying migration: ${filename}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1);`, [filename]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    logger.info('Migrations applied successfully');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations().catch((err: unknown) => {
    const e = err as Error;
    logger.error({ error: e.message, stack: e.stack }, 'Migration failed');
    console.error(e);
    process.exit(1);
  });
}
