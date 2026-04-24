# Product Filter Guide

## Overview

The product filter system allows you to reduce the dataset from all FTP products (~thousands) to a manageable subset (~5000) before pushing to Supabase and eventually Ecwid.

## Default Filter Criteria

The system comes with sensible defaults that filter out incomplete or invalid products:

```typescript
{
  requiresStock: true,              // Only products with stock > 0
  requiresPrice: true,              // Only products with valid EUR price
  requiresName: true,               // Only products with at least one name field
  categories: [],                   // Empty = allow all categories
  brands: [],                       // Empty = allow all brands
  minPrice: 0,                      // No minimum price by default
  maxPrice: undefined,              // No maximum price by default
  excludeCatalogRestricted: true,   // Exclude catalog-restricted items
}
```

## How to Customize Filters

### Option 1: Modify Default Criteria in Code

Edit `src/filters/product-filter.ts` and update the `DEFAULT_FILTER_CRITERIA` object:

```typescript
export const DEFAULT_FILTER_CRITERIA: FilterCriteria = {
  requiresStock: true,
  requiresPrice: true,
  requiresName: true,
  categories: ['CAT001', 'CAT002', 'CAT003'],  // Only these categories
  brands: ['BrandA', 'BrandB'],                // Only these brands
  minPrice: 10,                                // Minimum €10
  maxPrice: 1000,                              // Maximum €1000
  excludeCatalogRestricted: true,
};
```

### Option 2: Pass Custom Criteria at Runtime

In `src/worker.ts`, modify the filter initialization:

```typescript
const productFilter = new ProductFilter({
  requiresStock: true,
  requiresPrice: true,
  categories: ['TYRES', 'BATTERIES'],  // Example: only tyres and batteries
  minPrice: 20,
});
```

### Option 3: Use Custom Logic Function

For complex filtering logic, use the `customLogic` function:

```typescript
const productFilter = new ProductFilter({
  requiresStock: true,
  requiresPrice: true,
  customLogic: (product) => {
    // Example: Only products from specific vendors with stock in Sweden
    return product.vendor_name === 'Duell' && product.stock_sweden > 0;
  }
});
```

## Filter Statistics

The filter provides detailed statistics about what was filtered and why:

```typescript
const stats = productFilter.getFilterStats(validatedProducts);
console.log(stats);
// Output:
// {
//   total: 10000,
//   passed: 4823,
//   failed: 5177,
//   passRate: 48.23,
//   failureReasons: {
//     no_stock: 3200,
//     no_price: 1500,
//     no_name: 300,
//     catalog_restricted: 177
//   }
// }
```

## Common Filter Scenarios

### Scenario 1: Only In-Stock Products with Prices
```typescript
const filter = new ProductFilter({
  requiresStock: true,
  requiresPrice: true,
  requiresName: true,
});
```

### Scenario 2: Specific Product Categories
```typescript
const filter = new ProductFilter({
  requiresStock: true,
  categories: ['TYRES', 'WHEELS', 'BATTERIES'],
});
```

### Scenario 3: Price Range Filter
```typescript
const filter = new ProductFilter({
  requiresStock: true,
  requiresPrice: true,
  minPrice: 50,
  maxPrice: 500,
});
```

### Scenario 4: Brand Whitelist
```typescript
const filter = new ProductFilter({
  requiresStock: true,
  brands: ['Michelin', 'Bridgestone', 'Continental'],
});
```

### Scenario 5: Complex Business Logic
```typescript
const filter = new ProductFilter({
  requiresStock: true,
  requiresPrice: true,
  customLogic: (product) => {
    // Only premium products with high stock
    const isPremium = product.price_eur_excl_vat > 100;
    const hasHighStock = product.stock_total > 50;
    const isPopularBrand = ['Michelin', 'Bridgestone'].includes(product.brand);
    
    return isPremium && hasHighStock && isPopularBrand;
  }
});
```

## Dynamic Filter Updates

You can update filter criteria at runtime:

```typescript
const filter = new ProductFilter();

// Later in your code...
filter.updateCriteria({
  categories: ['NEW_CATEGORY'],
  minPrice: 100,
});
```

## Monitoring Filter Performance

The filter logs detailed information:

```
[INFO] ProductFilter initialized { criteria: {...} }
[INFO] Filtering 10000 products
[INFO] Filtered to 4823 products (48.2% retained)
```

## Best Practices

1. **Start Conservative**: Begin with strict filters (stock + price + name) to ensure quality
2. **Monitor Statistics**: Use `getFilterStats()` to understand what's being filtered out
3. **Iterate**: Gradually refine filters based on business requirements
4. **Document Changes**: Keep track of filter criteria changes in version control
5. **Test First**: Test filter changes with a small dataset before full deployment

## Next Steps

Once you've determined the exact filter requirements:

1. Update the filter criteria in `src/filters/product-filter.ts`
2. Test with `npm run dev`
3. Monitor the logs to see filter statistics
4. Adjust as needed to reach ~5000 products
5. Deploy to production

## Troubleshooting

**Too many products passing through?**
- Add more restrictive criteria (categories, brands, price ranges)
- Enable `excludeCatalogRestricted`
- Add custom logic for business-specific rules

**Too few products passing through?**
- Relax some criteria (e.g., set `requiresStock: false`)
- Remove category/brand restrictions
- Lower minimum price threshold
- Check filter statistics to see primary failure reasons
