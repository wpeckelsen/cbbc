import { Logger } from 'pino';
import { logger as defaultLogger } from '../logger';
import {
  createClient,
  getAppliedMigrations,
  listMigrationFiles,
} from './migration-utils';

export interface DriftResult {
  ok: boolean;
  applied: string[];
  pending: string[];
  orphaned: string[];
  error?: string;
}

/**
 * Compare migration files on disk against the `schema_migrations` table.
 *
 * - **pending**: files on disk that have not been applied yet.
 * - **orphaned**: entries in the DB whose file no longer exists on disk.
 *
 * Never throws — connection failures are captured in `result.error`.
 */
export async function checkDrift(log: Logger = defaultLogger): Promise<DriftResult> {
  const files = listMigrationFiles();

  let appliedSet: Set<string>;
  try {
    const client = await createClient();
    try {
      appliedSet = await getAppliedMigrations(client);
    } finally {
      await client.end();
    }
  } catch (err) {
    const msg = (err as Error).message;
    log.warn(`DB drift check skipped: could not connect to database (${msg})`);
    return { ok: false, applied: [], pending: files, orphaned: [], error: msg };
  }

  const applied = files.filter((f) => appliedSet.has(f));
  const pending = files.filter((f) => !appliedSet.has(f));
  const orphaned = Array.from(appliedSet).filter((f) => !files.includes(f));

  const ok = pending.length === 0 && orphaned.length === 0;

  if (ok) {
    log.info(
      `DB drift check passed (${applied.length}/${files.length} migrations applied, 0 pending)`,
    );
  } else {
    if (pending.length > 0) {
      log.warn(
        { pending },
        `DB drift check: ${pending.length} pending migration(s) — run \`npm run db:migrate\``,
      );
    }
    if (orphaned.length > 0) {
      log.warn(
        { orphaned },
        `DB drift check: ${orphaned.length} orphaned migration(s) in DB but missing on disk`,
      );
    }
  }

  return { ok, applied, pending, orphaned };
}

// Standalone CLI entry point: npm run db:check
if (require.main === module) {
  checkDrift()
    .then((result) => {
      if (!result.ok) process.exitCode = 1;
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
