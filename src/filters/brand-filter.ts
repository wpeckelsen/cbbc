import { Logger } from 'pino';
import { logger as defaultLogger } from '../logger';
import { canonicalizeBrand, resolveBrandName } from '../brands/brand-utils';

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
 * Filter products by a whitelist of canonical brand keys.
 *
 * For each product, resolves the brand the same way the rest of the pipeline
 * does (vendor_name first, `brand` as fallback), normalizes `vendor_name` in
 * place (underscores → spaces, auto-capitalize), then checks the canonical key
 * against the whitelist.
 *
 * Returns `{ kept, dropped }` so callers can trace why a product was dropped.
 * Mutates vendor_name on kept products so the cleaned value flows downstream.
 *
 * The filter is a no-op (returns all products, none dropped) when the whitelist
 * is empty or when `enabled` is explicitly false.
 */
export function brandFilter(
  products: any[],
  whitelist: Set<string>,
  log: Logger = defaultLogger,
  enabled: boolean = true,
): BrandFilterResult {
  if (!enabled) {
    log.info('Brand filter is disabled via config — skipping');
    return { kept: products, dropped: [] };
  }

  if (whitelist.size === 0) {
    log.info('Brand whitelist is empty — skipping brand filter');
    return { kept: products, dropped: [] };
  }

  const kept: any[] = [];
  const dropped: any[] = [];
  const matchedBrands = new Set<string>();

  for (const product of products) {
    // Resolve the brand: vendor_name first, fallback to brand (matches the
    // rest of the pipeline's brand resolution).
    const resolved = resolveBrandName(product.vendor_name, product.brand);

    // Normalize vendor_name in-place (underscores → spaces, title-case) so the
    // cleaned value flows downstream (existing behavior).
    product.vendor_name = normalizeVendorName(product.vendor_name);

    const key = canonicalizeBrand(resolved);
    if (whitelist.has(key)) {
      kept.push(product);
      matchedBrands.add(key);
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