# MVP Product Limits

## Current Configuration

### Hard Cap: 10 Products

For the MVP phase, the pipeline is configured to process a maximum of **10 products**.

This limit is set in `src/worker.ts`:

```typescript
const MVP_PRODUCT_LIMIT = 10;
```

## Pipeline Flow

```
FTP Download (127,528 products)
    ↓
Parse & Validate (enrich with prices, stock, images)
    ↓
Apply Filter (stock > 0, has price, has name, etc.)
    ↓ (~8,000-15,000 products pass filter)
Apply Hard Cap (10 products)
    ↓
Filter Related Data (prices, stock, images for those 10)
    ↓
Send to Supabase (ONLY 10 products + related data)
    ↓
Promote to Production (10 products)
```

## Why This Matters

✅ **Prevents Database Bloat**: Only 10 products are sent to Supabase, not 127k
✅ **Saves Storage**: Minimal database usage during MVP
✅ **Faster Testing**: Quick iterations with small dataset
✅ **Easy to Scale**: Change one number to increase limit

## How to Increase the Limit

When ready to move beyond MVP, simply update the limit in `src/worker.ts`:

```typescript
// For production with ~5000 products
const MVP_PRODUCT_LIMIT = 5000;
```

Or remove the cap entirely to use only filter criteria:

```typescript
// Use all filtered products (no hard cap)
const cappedProducts = filteredProducts; // Remove .slice(0, MVP_PRODUCT_LIMIT)
```

## Current Filter Criteria

Products must meet ALL of these criteria to be included:

- ✅ `stock_total > 0` (has available inventory)
- ✅ Has valid EUR price (excl or incl VAT)
- ✅ Has at least one product name (EN, FI, or SV)
- ✅ Not catalog-restricted

These filters typically reduce 127k products down to ~8k-15k products, then the hard cap selects the first 10.

## Monitoring

Check the logs to see filter performance:

```
[INFO] Parsed 127528 products from FTP
[INFO] Pre-filter: 127528 validated products
[INFO] Filter statistics { total: 127528, passed: 12453, failed: 115075, ... }
[INFO] Post-filter: 12453 products passed filter
[INFO] Applied hard cap: 10 products (limit: 10)
[INFO] Filtered related data: 10 prices, 10 stock records, 8 images
```

## Supabase Impact

With the 10-product limit:
- `products_staging`: ~10 rows
- `prices_staging`: ~10 rows
- `stock_staging`: ~10-20 rows
- `images_staging`: ~8-10 rows
- `products`: ~10 rows

**Total**: ~50-60 rows across all tables (vs 127k+ without filtering!)

## Next Steps

1. **Test with 10 products** - Verify pipeline works end-to-end
2. **Refine filters** - Adjust criteria to get the right products
3. **Increase limit** - When ready, bump to 100, 1000, or 5000
4. **Implement Ecwid sync** - Sync the filtered products to storefront
