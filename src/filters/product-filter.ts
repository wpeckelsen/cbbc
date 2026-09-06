import { Logger } from 'pino';
import { logger as defaultLogger } from '../logger';

export interface FilterCriteria {
  requiresStock?: boolean;           // Only products with stock > 0
  requiresPrice?: boolean;            // Only products with valid EUR price
  requiresName?: boolean;             // Only products with at least one name field
  categories?: string[];              // Whitelist of category codes (empty = allow all)
  brands?: string[];                  // Whitelist of brands (empty = allow all)
  minPrice?: number;                  // Minimum price threshold
  maxPrice?: number;                  // Maximum price threshold
  excludeCatalogRestricted?: boolean; // Exclude catalog-restricted items
  customLogic?: (product: any) => boolean; // Custom filter function
}

export const DEFAULT_FILTER_CRITERIA: FilterCriteria = {
  requiresStock: false,
  requiresPrice: false,
  requiresName: false,
  categories: [],
  brands: [],
  minPrice: 0,
  maxPrice: undefined,
  excludeCatalogRestricted: false,
  customLogic: undefined,
};

export class ProductFilter {
  private criteria: FilterCriteria;
  private log: Logger;

  constructor(criteria: FilterCriteria = DEFAULT_FILTER_CRITERIA, log: Logger = defaultLogger) {
    this.criteria = { ...DEFAULT_FILTER_CRITERIA, ...criteria };
    this.log = log;
  }

  /**
   * Filter a list of products based on criteria
   */
  filterProducts(products: any[]): any[] {
    this.log.debug(`Filtering ${products.length} products`);

    const filtered = products.filter(product => this.shouldIncludeProduct(product));

    this.log.debug(`Filtered to ${filtered.length} products (${((filtered.length / products.length) * 100).toFixed(1)}% retained)`);

    return filtered;
  }

  /**
   * Determine if a single product should be included
   */
  private shouldIncludeProduct(product: any): boolean {
    // Check stock requirement
    if (this.criteria.requiresStock) {
      const stockTotal = product.stock_total || 0;
      if (stockTotal <= 0) {
        return false;
      }
    }

    // Check price requirement
    if (this.criteria.requiresPrice) {
      const price = product.price_eur_excl_vat || product.price_eur_incl_vat;
      if (!price || price <= 0) {
        return false;
      }
    }

    // Check name requirement
    if (this.criteria.requiresName) {
      const hasName = product.name_en || product.name_fi || product.name_sv;
      if (!hasName) {
        return false;
      }
    }

    // Check category whitelist
    if (this.criteria.categories && this.criteria.categories.length > 0) {
      const productCategories = product.category_codes || [];
      const hasMatchingCategory = productCategories.some((cat: string) =>
        this.criteria.categories!.includes(cat)
      );
      if (!hasMatchingCategory) {
        return false;
      }
    }

    // Check brand whitelist
    if (this.criteria.brands && this.criteria.brands.length > 0) {
      const productBrand = product.brand || '';
      if (!this.criteria.brands.includes(productBrand)) {
        return false;
      }
    }

    // Check minimum price
    if (this.criteria.minPrice !== undefined) {
      const price = product.price_eur_excl_vat || product.price_eur_incl_vat || 0;
      if (price < this.criteria.minPrice) {
        return false;
      }
    }

    // Check maximum price
    if (this.criteria.maxPrice !== undefined) {
      const price = product.price_eur_excl_vat || product.price_eur_incl_vat || 0;
      if (price > this.criteria.maxPrice) {
        return false;
      }
    }

    // Check catalog restriction
    if (this.criteria.excludeCatalogRestricted) {
      const restriction = product.catalog_restriction || '';
      if (restriction && restriction.toLowerCase() !== 'none' && restriction.toLowerCase() !== '') {
        return false;
      }
    }

    // Apply custom logic if provided
    if (this.criteria.customLogic) {
      if (!this.criteria.customLogic(product)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Update filter criteria
   */
  updateCriteria(newCriteria: Partial<FilterCriteria>): void {
    this.criteria = { ...this.criteria, ...newCriteria };
    this.log.debug('Filter criteria updated');
  }

  /**
   * Get current filter criteria
   */
  getCriteria(): FilterCriteria {
    return { ...this.criteria };
  }

  /**
   * Get filter statistics for a product list
   */
  getFilterStats(products: any[]): {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    failureReasons: Record<string, number>;
  } {
    const stats = {
      total: products.length,
      passed: 0,
      failed: 0,
      passRate: 0,
      failureReasons: {} as Record<string, number>,
    };

    products.forEach(product => {
      if (this.shouldIncludeProduct(product)) {
        stats.passed++;
      } else {
        stats.failed++;
        // Track why it failed
        const reason = this.getFailureReason(product);
        stats.failureReasons[reason] = (stats.failureReasons[reason] || 0) + 1;
      }
    });

    stats.passRate = stats.total > 0 ? (stats.passed / stats.total) * 100 : 0;

    return stats;
  }

  /**
   * Determine the primary reason a product failed filtering
   */
  private getFailureReason(product: any): string {
    if (this.criteria.requiresStock && (product.stock_total || 0) <= 0) {
      return 'no_stock';
    }
    if (this.criteria.requiresPrice && !(product.price_eur_excl_vat || product.price_eur_incl_vat)) {
      return 'no_price';
    }
    if (this.criteria.requiresName && !(product.name_en || product.name_fi || product.name_sv)) {
      return 'no_name';
    }
    if (this.criteria.categories && this.criteria.categories.length > 0) {
      return 'category_mismatch';
    }
    if (this.criteria.brands && this.criteria.brands.length > 0) {
      return 'brand_mismatch';
    }
    if (this.criteria.excludeCatalogRestricted && product.catalog_restriction) {
      return 'catalog_restricted';
    }
    if (this.criteria.customLogic) {
      return 'custom_logic_failed';
    }
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Unified variant eligibility (consolidates former gates 1, 2, and 4)
// ---------------------------------------------------------------------------

/**
 * Single eligibility check for a validated variant, combining all checks that
 * were previously scattered across `isSellableParentRow` (gate 1), the
 * `customLogic` filter (gate 2), and the redundant guard inside
 * `promoteToProduction` (gate 4).
 *
 * Returns `{ eligible: true }` or `{ eligible: false, reason: string }`.
 */
export function isVariantEligible(variant: any): { eligible: boolean; reason?: string } {
  // Name (gates 1, 4)
  const nameEn = typeof variant.name_en === 'string' ? variant.name_en.trim() : '';
  if (nameEn === '') return { eligible: false, reason: 'no_name' };

  // Brand (gates 1, 2) — vendor_name is primary source, brand is fallback
  const brand = (typeof variant.vendor_name === 'string' && variant.vendor_name.trim() !== '')
    ? variant.vendor_name.trim()
    : (typeof variant.brand === 'string' ? variant.brand.trim() : '');
  if (brand === '') return { eligible: false, reason: 'no_brand' };

  // Vendor (gate 1)
  const vendorName = typeof variant.vendor_name === 'string' ? variant.vendor_name.trim() : '';
  if (vendorName === '') return { eligible: false, reason: 'no_vendor' };

  // Category codes (gates 1, 2)
  const categoryCodes = variant.category_codes;
  if (!Array.isArray(categoryCodes) || categoryCodes.length === 0) {
    return { eligible: false, reason: 'no_categories' };
  }

  // Barcode (gates 1, 4)
  const barcode = typeof variant.barcode === 'string' ? variant.barcode.trim() : '';
  if (barcode === '' || !/^\d+$/.test(barcode)) {
    return { eligible: false, reason: 'invalid_barcode' };
  }

  // Price (gates 1, 2, 4) — must be a positive number
  const priceExcl = variant.price_eur_excl_vat;
  if (typeof priceExcl !== 'number' || !Number.isFinite(priceExcl) || priceExcl <= 0) {
    return { eligible: false, reason: 'no_price' };
  }

  // Price incl (gate 4) — must be a valid number
  const priceIncl = variant.price_eur_incl_vat;
  if (typeof priceIncl !== 'number' || !Number.isFinite(priceIncl)) {
    return { eligible: false, reason: 'no_price' };
  }

  // Stock — must be at least 1 (in stock)
  const stockTotal = variant.stock_total;
  if (typeof stockTotal !== 'number' || !Number.isFinite(stockTotal) || stockTotal < 1) {
    return { eligible: false, reason: 'no_stock' };
  }

  // Image (gates 1, 2, 4) — must have at least one non-empty URL
  const imageUrls: string[] = Array.isArray(variant.image_urls) ? variant.image_urls : [];
  if (imageUrls.length === 0 || imageUrls.every(function(u: string) { return typeof u !== 'string' || u.trim() === ''; })) {
    return { eligible: false, reason: 'no_image' };
  }

  // Validation errors (gate 2)
  if (!Array.isArray(variant.errors) || variant.errors.length > 0) {
    return { eligible: false, reason: 'validation_errors' };
  }

  return { eligible: true };
}

/**
 * Compute summary statistics for a list of variants using the unified
 * eligibility check.
 */
export function getEligibilityStats(variants: any[]): {
  total: number;
  eligible: number;
  rejected: number;
  passRate: number;
  rejectionReasons: Record<string, number>;
} {
  const stats = {
    total: variants.length,
    eligible: 0,
    rejected: 0,
    passRate: 0,
    rejectionReasons: {} as Record<string, number>,
  };

  for (const v of variants) {
    const result = isVariantEligible(v);
    if (result.eligible) {
      stats.eligible++;
    } else {
      stats.rejected++;
      const reason = result.reason ?? 'unknown';
      stats.rejectionReasons[reason] = (stats.rejectionReasons[reason] ?? 0) + 1;
    }
  }

  stats.passRate = stats.total > 0 ? (stats.eligible / stats.total) * 100 : 0;
  return stats;
}

// ---------------------------------------------------------------------------
// Model consistency filter (former gate 3)
// ---------------------------------------------------------------------------

export interface ModelTruth {
  brand: string;
  vendor: string;
  categoryKey: string;
}

export interface ConsistencyResult {
  kept: any[];
  dropped: number;
  droppedModelCodes: Set<string>;
  droppedVariants: any[];
}

/**
 * Normalize an array of category codes: trim, deduplicate, sort.
 * Also handles string inputs by splitting on commas.
 */
export function normalizeCategoryCodes(value: any): string[] {
  if (!Array.isArray(value)) return [];
  const out = value
    .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
    .filter((v) => v !== '');
  out.sort((a, b) => a.localeCompare(b));
  return Array.from(new Set(out));
}

function toTruthKey(codes: any): string {
  const normalized = normalizeCategoryCodes(codes).map((c) => c.toLowerCase());
  return normalized.join('|');
}

function truthFromMeta(meta: any): ModelTruth | null {
  const vendor = typeof meta?.vendor_name === 'string' ? meta.vendor_name.trim().toLowerCase() : '';
  const brand = vendor === '' && typeof meta?.brand === 'string' ? meta.brand.trim().toLowerCase() : '';
  const categoryKey = toTruthKey(meta?.category_codes);
  if (brand === '' || vendor === '' || categoryKey === '') return null;
  return { brand, vendor, categoryKey };
}

function truthFromVariant(v: any): ModelTruth | null {
  const vendor = typeof v?.vendor_name === 'string' ? v.vendor_name.trim().toLowerCase() : '';
  const brand = vendor === '' && typeof v?.brand === 'string' ? v.brand.trim().toLowerCase() : '';
  const categoryKey = toTruthKey(v?.category_codes);
  if (brand === '' || vendor === '' || categoryKey === '') return null;
  return { brand, vendor, categoryKey };
}

/**
 * Filter out variants whose brand, vendor, or category codes conflict with the
 * established truth for their parent model (derived from metadata or the first
 * variant to set it).
 *
 * Variants without a known truth record are kept (no parent metadata means
 * nothing to conflict with). Variants that can't produce their own truth
 * signature are also kept (they can't meaningfully conflict).
 */
export function filterInconsistentVariants(
  validatedProducts: any[],
  modelMetadataByCode: Map<string, any>,
): ConsistencyResult {
  // Group variants by model_code
  const variantsByModel = new Map<string, any[]>();
  for (const v of validatedProducts) {
    const modelCode =
      typeof v.model_code === 'string' && v.model_code.trim() !== ''
        ? v.model_code.trim()
        : v.product_code;
    const arr = variantsByModel.get(modelCode) ?? [];
    arr.push(v);
    variantsByModel.set(modelCode, arr);
  }

  // Build truth table — prefer parent metadata, fall back to first variant
  const truthByModelCode = new Map<string, ModelTruth>();
  for (const [modelCode, meta] of modelMetadataByCode) {
    const t = truthFromMeta(meta);
    if (t) truthByModelCode.set(modelCode, t);
  }
  for (const [modelCode, modelVariants] of variantsByModel) {
    if (truthByModelCode.has(modelCode)) continue;
    for (const v of modelVariants) {
      const t = truthFromVariant(v);
      if (t) {
        truthByModelCode.set(modelCode, t);
        break;
      }
    }
  }

  let dropped = 0;
  const droppedModelCodes = new Set<string>();
  const droppedVariants: any[] = [];
  const kept: any[] = [];

  for (const v of validatedProducts) {
    const modelCode =
      typeof v.model_code === 'string' && v.model_code.trim() !== ''
        ? v.model_code.trim()
        : v.product_code;
    const truth = truthByModelCode.get(modelCode);
    if (!truth) { kept.push(v); continue; } // No truth record — nothing to conflict with
    const vt = truthFromVariant(v);
    if (!vt) { kept.push(v); continue; } // Variant can't produce a truth signature — keep
    if (
      vt.brand !== truth.brand ||
      vt.vendor !== truth.vendor ||
      vt.categoryKey !== truth.categoryKey
    ) {
      dropped++;
      droppedModelCodes.add(modelCode);
      droppedVariants.push(v);
    } else {
      kept.push(v);
    }
  }

  return { kept, dropped, droppedModelCodes, droppedVariants };
}