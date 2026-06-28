import { Pool, types } from 'pg';
import { Logger } from 'pino';
import { config } from '../config/env';
import { logger as defaultLogger } from '../logger';
import { preflightDropUnknownColumns } from '../db/schema-preflight';

// pg returns NUMERIC (OID 1700) as strings by default to avoid precision loss.
// The codebase expects JS numbers (the old Supabase REST layer returned JSON
// numbers). Register a global parser so every pool/client sees numbers instead.
types.setTypeParser(1700, (val: string) => parseFloat(val));

/** PostgreSQL max bind parameters per query. */
const PG_MAX_PARAMS = 65535;

let sharedPool: Pool | null = null;

function getPool(): Pool {
  if (!sharedPool) {
    const url = config.database.url;
    if (!url) throw new Error('Database URL is not set — set DATABASE_PUBLIC_URL (dev) or DATABASE_URL (prod) in .env');
    sharedPool = new Pool({ connectionString: url, max: 10 });
  }
  return sharedPool;
}

/** Expose the shared pool for modules that need raw pg access. */
export function getDatabasePool(): Pool {
  return getPool();
}

export class DatabaseClient {
  private log: Logger;

  constructor(log: Logger = defaultLogger) {
    this.log = log;
  }

  private get pool(): Pool {
    return getPool();
  }

  /**
   * Insert records into a table (auto-batches to stay within pg parameter limit).
   */
  async insert<T>(
    table: string,
    records: any[],
    opts?: { boundary?: string }
  ): Promise<T[]> {
    if (records.length === 0) return [];

    const boundary = opts?.boundary ?? `db.insert:${table}`;
    const preflight = await preflightDropUnknownColumns(table, records, boundary);
    const rows = preflight.records;

    this.log.debug(`Inserting ${rows.length} records into ${table}`);

    const columns = Object.keys(rows[0]);
    const quotedCols = columns.map((c) => `"${c}"`).join(', ');
    const returning = this.buildReturningClause(columns);
    const batchSize = Math.max(1, Math.floor(PG_MAX_PARAMS / columns.length));

    const allResults: T[] = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values: any[] = [];
      const valueClauses: string[] = [];

      for (const row of batch) {
        const placeholders: string[] = [];
        for (const col of columns) {
          values.push(this.serializeValue(row[col]));
          placeholders.push(`$${values.length}`);
        }
        valueClauses.push(`(${placeholders.join(', ')})`);
      }

      const sql = `INSERT INTO "${table}" (${quotedCols}) VALUES ${valueClauses.join(', ')} ${returning}`;
      const result = await this.pool.query(sql, values);
      allResults.push(...(result.rows as T[]));
    }

    return allResults;
  }

  /**
   * Upsert records (auto-batches to stay within pg parameter limit).
   */
  async upsert<T>(
    table: string,
    records: any[],
    onConflict?: string,
    opts?: { boundary?: string }
  ): Promise<T[]> {
    if (records.length === 0) return [];

    const boundary = opts?.boundary ?? `db.upsert:${table}`;
    const preflight = await preflightDropUnknownColumns(table, records, boundary);
    const rows = preflight.records;

    this.log.debug(`Upserting ${rows.length} records into ${table}`);

    const columns = Object.keys(rows[0]);
    const quotedCols = columns.map((c) => `"${c}"`).join(', ');
    const returning = this.buildReturningClause(columns);
    const batchSize = Math.max(1, Math.floor(PG_MAX_PARAMS / columns.length));

    let conflictClause = '';
    if (onConflict) {
      const conflictCols = onConflict.split(',').map((c) => `"${c.trim()}"`).join(', ');
      const updateCols = columns
        .filter((c) => !onConflict.split(',').map((s) => s.trim()).includes(c))
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(', ');
      conflictClause = updateCols
        ? ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateCols}`
        : ` ON CONFLICT (${conflictCols}) DO NOTHING`;
    }

    const allResults: T[] = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values: any[] = [];
      const valueClauses: string[] = [];

      for (const row of batch) {
        const placeholders: string[] = [];
        for (const col of columns) {
          values.push(this.serializeValue(row[col]));
          placeholders.push(`$${values.length}`);
        }
        valueClauses.push(`(${placeholders.join(', ')})`);
      }

      const sql = `INSERT INTO "${table}" (${quotedCols}) VALUES ${valueClauses.join(', ')}${conflictClause} ${returning}`;
      const result = await this.pool.query(sql, values);
      allResults.push(...(result.rows as T[]));
    }

    return allResults;
  }

  /**
   * Select records from a table.
   */
  async select<T>(
    table: string,
    columns: string = '*',
    filters?: Record<string, any>,
    limit?: number,
    orderBy?: { column: string; ascending?: boolean },
    offset?: number
  ): Promise<T[]> {
    const params: any[] = [];
    let sql = `SELECT ${columns} FROM "${table}"`;

    if (filters && Object.keys(filters).length > 0) {
      const clauses: string[] = [];
      for (const [key, value] of Object.entries(filters)) {
        params.push(value);
        clauses.push(`"${key}" = $${params.length}`);
      }
      sql += ` WHERE ${clauses.join(' AND ')}`;
    }

    if (orderBy) {
      const dir = orderBy.ascending === false ? 'DESC' : 'ASC';
      sql += ` ORDER BY "${orderBy.column}" ${dir}`;
    }

    if (limit) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }

    if (typeof offset === 'number' && offset > 0) {
      params.push(offset);
      sql += ` OFFSET $${params.length}`;
    }

    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  /**
   * Update records in a table.
   */
  async update<T>(
    table: string,
    updates: Record<string, any>,
    filters: Record<string, any>
  ): Promise<T[]> {
    const params: any[] = [];

    const setClauses: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      params.push(this.serializeValue(value));
      setClauses.push(`"${key}" = $${params.length}`);
    }

    const whereClauses: string[] = [];
    for (const [key, value] of Object.entries(filters)) {
      params.push(value);
      whereClauses.push(`"${key}" = $${params.length}`);
    }

    const sql = `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')} RETURNING *`;

    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  /**
   * Delete records from a table.
   */
  async delete(table: string, filters: Record<string, any>): Promise<void> {
    const params: any[] = [];
    const clauses: string[] = [];

    for (const [key, value] of Object.entries(filters)) {
      params.push(value);
      clauses.push(`"${key}" = $${params.length}`);
    }

    await this.pool.query(
      `DELETE FROM "${table}" WHERE ${clauses.join(' AND ')}`,
      params
    );
  }

  /**
   * Delete all rows from a table where a given column is not null.
   */
  async deleteAllByNonNullColumn(table: string, nonNullColumn: string): Promise<void> {
    this.log.warn(`Deleting all rows from table: ${table} (where ${nonNullColumn} is not null)`);
    await this.pool.query(`DELETE FROM "${table}" WHERE "${nonNullColumn}" IS NOT NULL`);
  }

  private serializeValue(value: any): any {
    return value;
  }

  private buildReturningClause(columns: string[]): string {
    return 'RETURNING ' + columns.map((c) => `"${c}"`).join(', ');
  }
}

/** Default singleton — pool is created lazily on first DB call. */
export const databaseClient = new DatabaseClient();
