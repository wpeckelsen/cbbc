import { logger } from '../logger';
import { createClient } from './migration-utils';
import { runMigrations } from './migrate';
import { config } from '../config/env';

function assertAllowedToReset(): void {
  if (config.isProd) {
    throw new Error('Refusing to reset remote DB when ENV=prod');
  }

  if (process.env.CONFIRM_NUKE !== 'YES') {
    throw new Error('Refusing to reset remote DB unless CONFIRM_NUKE=YES');
  }
}

async function resetRemote(): Promise<void> {
  assertAllowedToReset();

  const client = await createClient();

  try {
    logger.warn('Resetting remote database: dropping all objects in schema public');

    await client.query(`
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;

  FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
    EXECUTE 'DROP SEQUENCE IF EXISTS public.' || quote_ident(r.sequence_name) || ' CASCADE';
  END LOOP;

  FOR r IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public') LOOP
    EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.table_name) || ' CASCADE';
  END LOOP;

  FOR r IN (SELECT matviewname FROM pg_matviews WHERE schemaname = 'public') LOOP
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.' || quote_ident(r.matviewname) || ' CASCADE';
  END LOOP;

  FOR r IN (
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ) LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(r.proname) || '(' || r.args || ') CASCADE';
  END LOOP;

  FOR r IN (
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('c', 'e')
  ) LOOP
    EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
  END LOOP;
END $$;
`);

    logger.info('Public schema cleared');
  } finally {
    await client.end();
  }

  await runMigrations();
}

resetRemote().catch((err: unknown) => {
  const e = err as Error;
  logger.error({ error: e.message, stack: e.stack }, 'Remote reset failed');
  console.error(e);
  process.exit(1);
});
