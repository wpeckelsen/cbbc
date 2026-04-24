import { logger } from '../logger';

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

  constructor(criteria: FilterCriteria = DEFAULT_FILTER_CRITERIA) {
    this.criteria = { ...DEFAULT_FILTER_CRITERIA, ...criteria };
    logger.info('ProductFilter initialized', { criteria: this.criteria });
  }

  /**
   * Filter a list of products based on criteria
   */
  filterProducts(products: any[]): any[] {
    logger.info(`Filtering ${products.length} products`);
    
    const filtered = products.filter(product => this.shouldIncludeProduct(product));
    
    logger.info(`Filtered to ${filtered.length} products (${((filtered.length / products.length) * 100).toFixed(1)}% retained)`);
    
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
    logger.info('Filter criteria updated', { criteria: this.criteria });
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
