// ---------------------------------------------------------------------------
// Brand identity: canonicalization + resolution.
//
// A brand's "key" is its identity for matching, deduplication, and storage.
// Every brand — whether from the FTP feed, from the frontend UI, or from the
// seed list — is run through the same canonicalizer so spellings that differ
// only in case, underscores, or whitespace collapse to the same brand. The FTP
// feed is the source of truth for the display name.
// ---------------------------------------------------------------------------

/**
 * Canonical key for a brand: lowercase, underscores → spaces, collapse
 * whitespace, trim. `Yakk_exp` and `Yakk Exp` both become `yakk exp`.
 */
export function canonicalizeBrand(raw: string | undefined | null): string {
  if (typeof raw !== 'string') return '';
  return raw
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Human-facing display name: underscores → spaces, collapse whitespace, trim.
 * Casing is preserved so the supplier's own spelling (e.g. `SENA`, `K&N`) is
 * kept rather than re-cased.
 */
export function displayBrand(raw: string | undefined | null): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a product's brand the same way the rest of the pipeline does:
 * `vendor_name` first, falling back to `brand` when `vendor_name` is empty.
 */
export function resolveBrandName(vendorName: any, brand: any): string {
  const vendor = typeof vendorName === 'string' ? vendorName.trim() : '';
  if (vendor !== '') return vendor;
  return typeof brand === 'string' ? brand.trim() : '';
}
