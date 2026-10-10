import { Logger } from 'pino';
import { DatabaseClient, databaseClient as defaultDatabaseClient } from './db-client';
import { logger as defaultLogger } from '../logger';
import { canonicalizeBrand, displayBrand, resolveBrandName } from '../brands/brand-utils';

// Module-level logger + database client, configurable per pipeline run.
let log: Logger = defaultLogger;
let dbClient: DatabaseClient = defaultDatabaseClient;

/** Configure the module for the current pipeline run. Mirrors products-api. */
export function configureBrandsApi(logger: Logger, client?: DatabaseClient): void {
  log = logger;
  if (client) dbClient = client;
}

/**
 * Load the whitelisted brand keys as a Set of canonical keys. An empty table
 * means "allow all brands" (the brand filter is then a no-op).
 */
export async function loadBrandWhitelistKeys(): Promise<Set<string>> {
  const rows = await dbClient.select<{ brand_key: string }>('brand_whitelist', 'brand_key');
  return new Set(rows.map((r) => r.brand_key));
}

/**
 * Rebuild the brand catalog from the full supplier product feed (pre-filter),
 * so the frontend can offer every brand the supplier sells. The FTP feed is the
 * source of truth, so brands no longer present are removed.
 */
export async function refreshBrandCatalog(products: any[]): Promise<void> {
  const byKey = new Map<string, string>();
  for (const product of products) {
    const resolved = resolveBrandName(product?.vendor_name, product?.brand);
    const key = canonicalizeBrand(resolved);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, displayBrand(resolved));
  }

  if (byKey.size === 0) {
    // Safety: an empty feed must not wipe the catalog.
    log.warn('Brand catalog refresh: no brands found in feed — skipping (empty or malformed feed?)');
    return;
  }

  const rows = [...byKey.entries()].map(([brand_key, display_name]) => ({ brand_key, display_name }));
  await dbClient.upsert('brand_catalog', rows, 'brand_key', { boundary: 'brand.catalog' });

  const stale = await dbClient.deleteWhereNotInReturning(
    'brand_catalog',
    'brand_key',
    rows.map((r) => r.brand_key),
    ['brand_key'],
  );

  log.info(`Brand catalog refreshed: ${rows.length} brands upserted, ${stale.length} removed`);
}
