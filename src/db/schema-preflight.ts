import { Logger } from 'pino';
import { logger as defaultLogger } from '../logger';
import { getDatabasePool } from '../api/db-client';

const columnsCache = new Map<string, Set<string>>();

async function fetchTableColumns(table: string): Promise<Set<string>> {
  const cacheKey = `public.${table}`;
  const cached = columnsCache.get(cacheKey);
  if (cached) return cached;

  const pool = getDatabasePool();
  const res = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position ASC;`,
    [table]
  );

  const set = new Set<string>((res.rows as Array<{ column_name: string }>).map((r) => r.column_name));
  columnsCache.set(cacheKey, set);
  return set;
}

export async function preflightDropUnknownColumns(
  table: string,
  records: Array<Record<string, any>>,
  boundary: string,
  log: Logger = defaultLogger,
): Promise<{ records: Array<Record<string, any>>; droppedKeys: string[] }> {
  if (records.length === 0) return { records, droppedKeys: [] };

  let columns: Set<string> | null = null;
  try {
    columns = await fetchTableColumns(table);
  } catch (error) {
    const err = error as Error;
    log.warn(
      { boundary, table, error: err.message },
      'Schema preflight skipped (failed to introspect DB columns)'
    );
    return { records, droppedKeys: [] };
  }

  const unknown = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (!columns.has(k)) unknown.add(k);
    }
  }

  const droppedKeys = Array.from(unknown).sort();
  if (droppedKeys.length === 0) return { records, droppedKeys: [] };

  const filtered = records.map((r) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) {
      if (columns!.has(k)) out[k] = v;
    }
    return out;
  });

  log.warn(
    {
      boundary,
      table,
      droppedKeys,
      sampleKeys: Object.keys(records[0] ?? {}).sort(),
    },
    'Dropped unknown columns from DB payload'
  );

  return { records: filtered, droppedKeys };
}
