import { logger } from '../logger';
import { createClient, getAppliedMigrations, listMigrationFiles } from './migration-utils';

async function status(): Promise<void> {
  const client = await createClient();

  try {
    const applied = await getAppliedMigrations(client);
    const files = listMigrationFiles();

    const pending = files.filter((f) => !applied.has(f));
    const appliedList = files.filter((f) => applied.has(f));

    logger.info(
      {
        appliedCount: appliedList.length,
        pendingCount: pending.length,
        applied: appliedList,
        pending,
      },
      'Migration status'
    );
  } finally {
    await client.end();
  }
}

status().catch((err: unknown) => {
  const e = err as Error;
  logger.error({ error: e.message, stack: e.stack }, 'Status failed');
  console.error(e);
  process.exit(1);
});
