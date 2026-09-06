import { Logger } from 'pino';
import { logger as defaultLogger } from '../logger';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Parse the brands whitelist from brands.md
// ---------------------------------------------------------------------------

let brandWhitelist: Set<string> | null = null;
let brandWhitelistOriginal: string[] = [];

function loadBrandWhitelist(log: Logger): Set<string> {
  if (brandWhitelist !== null) return brandWhitelist;

  const brandsPath = path.join(__dirname, '../../brands.md');
  if (!fs.existsSync(brandsPath)) {
    log.warn('brands.md not found — brand filter is disabled');
    brandWhitelist = new Set();
    return brandWhitelist;
  }

  try {
    const raw = fs.readFileSync(brandsPath, 'utf-8').trim();
    if (raw === '') {
      log.warn('brands.md is empty — brand filter is disabled');
      brandWhitelist = new Set();
      return brandWhitelist;
    }

    brandWhitelistOriginal = raw
      .split(',')
      .map((b) => b.trim())
      .filter((b) => b !== '');

    brandWhitelist = new Set(brandWhitelistOriginal.map((b) => b.toLowerCase()));

    log.info(`Loaded ${brandWhitelist.size} brands from brands.md`);
    return brandWhitelist;
  } catch (err) {
    log.error({ error: (err as Error).message }, 'Failed to read brands.md — brand filter is disabled');
    brandWhitelist = new Set();
    return brandWhitelist;
  }
}

// ---------------------------------------------------------------------------
// Vendor name normalization: underscores → spaces + auto-capitalize
// ---------------------------------------------------------------------------

/**
 * Normalize a vendor_name:
 * 1. Replace underscores with spaces
 * 2. Title-case each word (first letter uppercase, rest lowercase)
 *
 * Handles edge cases:
 * - "K&N" → "K&N" (preserves the ampersand)
 * - "X-1R" → "X-1r" would become "X-1r" — title-case preserves this since
 *   each word is handled independently (digits don't have case).
 * - Empty/undefined → returns original value unchanged
 */
export function normalizeVendorName(raw: string | undefined | null): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed === '') return '';

  // Replace underscores with spaces
  const withSpaces = trimmed.replace(/_/g, ' ');

  // Title-case each word: first letter uppercase, rest lowercase
  const titleCased = withSpaces
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  return titleCased;
}

// ---------------------------------------------------------------------------
// Brand filter function
// ---------------------------------------------------------------------------

export interface BrandFilterResult {
  kept: any[];
  dropped: any[];
}

/**
 * Filter products by brand whitelist (from brands.md).
 *
 * For each product, normalizes the vendor_name field (underscores → spaces,
 * auto-capitalize) in-place, then checks against the whitelist.
 *
 * Returns `{ kept, dropped }` so callers can trace why a product was dropped.
 * Mutates vendor_name on kept products so the cleaned value flows downstream.
 *
 * The filter is a no-op (returns all products, none dropped) when brands.md is
 * missing/empty or when `enabled` is explicitly false.
 */
export function brandFilter(
  products: any[],
  log: Logger = defaultLogger,
  enabled: boolean = true,
): BrandFilterResult {
  if (!enabled) {
    log.info('Brand filter is disabled via config — skipping');
    return { kept: products, dropped: [] };
  }

  const whitelist = loadBrandWhitelist(log);
  if (whitelist.size === 0) {
    log.info('Brand whitelist is empty — skipping brand filter');
    return { kept: products, dropped: [] };
  }

  const kept: any[] = [];
  const dropped: any[] = [];
  const matchedBrands = new Set<string>();

  for (const product of products) {
    const rawVendor = product.vendor_name;
    const normalized = normalizeVendorName(rawVendor);

    // Write normalized name back in-place so downstream code sees cleaned value
    product.vendor_name = normalized;

    if (whitelist.has(normalized.toLowerCase())) {
      kept.push(product);
      matchedBrands.add(normalized);
    } else {
      dropped.push(product);
    }
  }

  log.info(
    `Brand filter: ${products.length} products → ${kept.length} kept, ${dropped.length} dropped ` +
    `(${matchedBrands.size} distinct brands matched)`,
  );
  log.debug(`Matched brands: ${[...matchedBrands].sort().join(', ')}`);

  return { kept, dropped };
}