import { config } from '../config/env';
import { logger } from '../logger';
import { preflightDropUnknownColumns } from '../db/schema-preflight';

export class SupabaseClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.database.supabaseUrl;
    this.apiKey = config.database.supabaseKey;
  }

  /**
   * Generic method to make requests to Supabase REST API
   */
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
    body?: any,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/rest/v1/${endpoint}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const headers: Record<string, string> = {
      'apikey': this.apiKey,
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation, resolution=merge-duplicates',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url.toString(), options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Handle empty responses (e.g., DELETE)
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json() as T;
      }

      return [] as T;
    } catch (error) {
      const err = error as Error;
      let detailedErrorMessage = err.message;
      let supabaseErrorDetails: any = null;

      // Attempt to parse the errorText from the thrown error message if it exists
      // This regex assumes the error message format from line 51: "Supabase API error: STATUS STATUS_TEXT - ERROR_TEXT"
      const supabaseApiErrorRegex = /^Supabase API error: \d+ .+? - (.*)$/;
      const match = err.message.match(supabaseApiErrorRegex);

      if (match && match[1]) {
          try {
              // Try to parse the error text as JSON, which is common for Supabase API errors
              supabaseErrorDetails = JSON.parse(match[1]);
              // Keep the original detailed message for clarity in the main error field
              detailedErrorMessage = `Supabase API error: ${match[1]}`;
          } catch (parseError) {
              // If parsing fails, it means the error text wasn't JSON. Log it as raw text.
              supabaseErrorDetails = { raw: match[1] };
              detailedErrorMessage = `Supabase API error: ${match[1]}`;
          }
      } else {
          // If the error message doesn't match the expected format, log the raw message
          supabaseErrorDetails = { raw: err.message };
      }

      logger.error('Supabase request failed', {
        endpoint,
        method,
        // Stringify body for logging, handle cases where body might be undefined or complex
        body: body ? JSON.stringify(body) : undefined,
        error: detailedErrorMessage, // The primary error message
        supabaseDetails: supabaseErrorDetails, // Structured details from Supabase if parsed
      });
      throw error; // Re-throw the original error to maintain existing error handling flow
    }
  }

  /**
   * Insert records into a table
   */
  async insert<T>(
    table: string,
    records: any[],
    opts?: {
      boundary?: string;
    }
  ): Promise<T[]> {
    if (records.length === 0) return [];

    const boundary = opts?.boundary ?? `supabase.insert:${table}`;
    const preflight = await preflightDropUnknownColumns(table, records, boundary);
    
    logger.info(`Inserting ${preflight.records.length} records into ${table}`);
    return this.request<T[]>(table, 'POST', preflight.records);
  }

  /**
   * Upsert records (insert or update on conflict)
   */
  async upsert<T>(
    table: string,
    records: any[],
    onConflict?: string,
    opts?: {
      boundary?: string;
    }
  ): Promise<T[]> {
    if (records.length === 0) return [];
    
    const params: Record<string, string> = {};
    if (onConflict) {
      params['on_conflict'] = onConflict;
    }

    const boundary = opts?.boundary ?? `supabase.upsert:${table}`;
    const preflight = await preflightDropUnknownColumns(table, records, boundary);

    logger.info(`Upserting ${preflight.records.length} records into ${table}`);
    return this.request<T[]>(table, 'POST', preflight.records, params);
  }

  /**
   * Select records from a table
   */
  async select<T>(
    table: string,
    columns: string = '*',
    filters?: Record<string, any>,
    limit?: number,
    orderBy?: {
      column: string;
      ascending?: boolean;
    }
  ): Promise<T[]> {
    const params: Record<string, string> = {
      select: columns,
    };

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        params[key] = `eq.${value}`;
      });
    }

    if (limit) {
      params['limit'] = limit.toString();
    }

    if (orderBy) {
      params['order'] = `${orderBy.column}.${orderBy.ascending === false ? 'desc' : 'asc'}`;
    }

    return this.request<T[]>(table, 'GET', undefined, params);
  }

  /**
   * Update records in a table
   */
  async update<T>(
    table: string,
    updates: any,
    filters: Record<string, any>
  ): Promise<T[]> {
    const params: Record<string, string> = {};
    
    Object.entries(filters).forEach(([key, value]) => {
      params[key] = `eq.${value}`;
    });

    return this.request<T[]>(table, 'PATCH', updates, params);
  }

  /**
   * Delete records from a table
   */
  async delete(table: string, filters: Record<string, any>): Promise<void> {
    const params: Record<string, string> = {};
    
    Object.entries(filters).forEach(([key, value]) => {
      params[key] = `eq.${value}`;
    });

    await this.request(table, 'DELETE', undefined, params);
  }

  /**
   * Delete all rows from a table by using a non-null filter on a known column.
   * This avoids assuming the presence of an `id` column.
   */
  async deleteAllByNonNullColumn(table: string, nonNullColumn: string): Promise<void> {
    logger.warn(`Deleting all rows from table: ${table} (where ${nonNullColumn} is not null)`);
    await this.request(table, 'DELETE', undefined, { [nonNullColumn]: 'not.is.null' });
  }

  /**
   * Execute a stored procedure/RPC
   */
  async rpc<T>(functionName: string, params?: any): Promise<T> {
    return this.request<T>(`rpc/${functionName}`, 'POST', params);
  }

  /**
   * Clear all records from a table (use with caution!)
   */
  async truncate(table: string): Promise<void> {
    logger.warn(`Truncating table: ${table}`);
    // Supabase doesn't have a direct truncate, so we delete all with a wildcard.
    // This assumes the table has an `id` column. Prefer deleteAllByNonNullColumn for other tables.
    await this.deleteAllByNonNullColumn(table, 'id');
  }
}

export const supabaseClient = new SupabaseClient();
