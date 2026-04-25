# Architecture Documentation

## Overview

This service fetches product data from an FTP server, validates and filters it, stores it in Supabase via REST API, and prepares it for sync to Ecwid.

## Architecture Changes (v2.0)

### Previous Architecture (v1.0)
- Direct PostgreSQL connection using `pg` library
- No filtering - all products processed
- Hardcoded 10-product limit for MVP

### Current Architecture (v2.0)
- **Supabase REST API** instead of direct database connection
- **Product filtering** during ingestion (~5000 products) but cap at 10 for mvp
- **Scalable** and ready for Ecwid sync

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     FTP Server (Duell)                      │
│  Products, Prices, Stock, Categories, Images                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   FTP Client (with retry)                   │
│  Downloads CSV files to temp directory                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    CSV Parser                               │
│  Parses products, prices, stock, categories, images         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 Product Validator                           │
│  Enriches products with price, stock, image data            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Product Filter (NEW!)                          │
│  Filters to ~5000 products based on criteria                │
│  - Stock availability                                       │
│  - Price validity                                           │
│  - Name presence                                            │
│  - Category/brand whitelists                                │
│  - Custom business logic                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│           Supabase REST API Client (NEW!)                   │
│  Replaces direct PostgreSQL connection                      │
│  - Insert/upsert to staging tables                          │
│  - Promote to production tables                             │
│  - Track sync status                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  Supabase Database                          │
│  Staging Tables → Production Tables                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Ecwid Sync (Future)                            │
│  Sync ~5000 filtered products to Ecwid storefront           │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Step 1: FTP Download
- Connect to FTP server
- Download latest CSV files:
  - `products.csv` (or timestamped variant)
  - `Retail_pricelist.csv`
  - `ic_CSV.csv` (stock by product code)
  - `ic_ean_CSV.csv` (stock by EAN)
  - `product_category_descriptions.csv`
  - `product_category_hierarchy.csv`
  - `product_images.csv`

### Step 2: Parse & Validate
- Parse CSV files into structured data
- Validate required fields
- Enrich products with price, stock, and image data

### Step 3: Filter (NEW!)
- Apply filter criteria to reduce dataset
- Default filters:
  - `requiresStock: true` - Only products with stock > 0
  - `requiresPrice: true` - Only products with valid EUR price
  - `requiresName: true` - Only products with at least one name
  - `excludeCatalogRestricted: true` - Exclude restricted items
- Log filter statistics for monitoring

### Step 4: Stage Data
- Insert/upsert to Supabase staging tables via REST API:
  - `products_staging`
  - `prices_staging`
  - `stock_staging`
  - `images_staging`
  - `categories`
  - `category_hierarchy`

### Step 5: Promote to Production
- Upsert filtered products to `products` table
- Mark status as `valid` or `invalid`
- Track `imported_at` timestamp

### Step 6: Ecwid Sync (Future)
- Sync valid products to Ecwid
- Update `last_synced_at` timestamp
- Log sync results to `ecwid_sync_logs`

## Key Files

### Core Pipeline
- `src/worker.ts` - Main orchestration and cron scheduling
- `src/logger.ts` - Structured logging with Pino

### FTP & Parsing
- `src/ftp/ftp-client.ts` - FTP download with retry logic
- `src/parsers/csv-parser.ts` - CSV parsing utilities

### Validation & Filtering
- `src/validation/product-validator.ts` - Product validation and enrichment
- `src/filters/product-filter.ts` - **NEW** Product filtering logic

### API Layer (NEW!)
- `src/api/supabase-client.ts` - **NEW** Supabase REST API wrapper
- `src/api/products-api.ts` - **NEW** Product CRUD operations

### Configuration
- `src/config/env.ts` - Environment configuration
- `.env` - Environment variables (Supabase, Ecwid, FTP credentials)

### Future Implementation
- `src/ecwid/ecwid-client.ts` - Ecwid API client (placeholder)

## Environment Variables

```bash
# FTP Configuration
FTP_HOST=updateftp.duell.fi
FTP_USER=duellus
FTP_PASS=WebUpdate!

# Supabase Configuration
SUPABASE_API_BASE_URL=https://xxx.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxx

# Ecwid Configuration
ECWID_STORE_ID=2281009
ECWID_SECRET_TOKEN=secret_xxx
ECWID_API_BASE_URL=https://app.ecwid.com/api/v3/2281009

# Logging
LOG_LEVEL=info

# Cron Schedule (daily at 2 AM)
CRON_SCHEDULE=0 2 * * *

# Environment
NODE_ENV=development
```

## Database Schema

### Staging Tables
- `products_staging` - Raw product data
- `prices_staging` - Price data by product code
- `stock_staging` - Stock levels (by product code and EAN)
- `images_staging` - Product images

### Reference Tables
- `categories` - Category descriptions
- `category_hierarchy` - Category relationships

### Production Tables
- `products` - Validated, filtered products ready for sync
- `ecwid_sync_logs` - Sync history and status

## API Endpoints Used

### Supabase REST API
- `POST /rest/v1/{table}` - Insert/upsert records
- `GET /rest/v1/{table}` - Select records
- `PATCH /rest/v1/{table}` - Update records
- `DELETE /rest/v1/{table}` - Delete records

All requests include:
- `apikey` header - Supabase API key
- `Authorization` header - Bearer token
- `Prefer: return=representation` - Return inserted/updated data

## Error Handling

### Network Failures
- FTP downloads: 3 retries with exponential backoff
- Supabase API: Automatic retry on network errors
- Ecwid API: 3 retries with exponential backoff (future)

### Data Validation
- Invalid products logged but not promoted to production
- Validation errors tracked in product status
- Filter statistics logged for monitoring

### Critical Failures
- Pipeline aborts on critical errors
- Logs preserved for debugging
- Safe to restart - idempotent operations
 /§   
## Monitoring & Logging

### Log Levels
- `info` - Normal operations, filter statistics
- `warn` - Non-critical issues (e.g., missing optional files)
- `error` - Critical failures requiring attention

### Key Metrics to Monitor
- Total products fetched from FTP
- Products passing validation
- Products passing filters (should be ~5000)
- Filter statistics (failure reasons)
- API response times
- Sync success/failure rates

## Deployment

### Local Development
```bash
npm install
npm run dev
```

### Docker Build
```bash
npm run docker:build
npm run docker:run
```

### Production
```bash
docker-compose up -d
```

## Scaling Considerations

### Current Limits
- ~5000 products after filtering
- Supabase REST API rate limits apply
- Ecwid API rate limits (to be determined)

### Future Optimizations
- Batch API requests for better performance
- Implement caching for category/hierarchy data
- Add incremental sync (only changed products)
- Implement webhook-based updates instead of polling

## Security

### Credentials
- All credentials stored in `.env` (not committed)
- Supabase uses service role key for full access
- FTP credentials transmitted over secure connection

### Data Validation
- SQL injection prevention via parameterized queries (API handles this)
- Input sanitization in validators
- Strict type checking with TypeScript

## Next Steps

1. **Determine Exact Filter Criteria**
   - Analyze product data to determine optimal filters
   - Aim for ~5000 products
   - Document chosen criteria

2. **Test Filter Performance**
   - Run pipeline with real data
   - Monitor filter statistics
   - Adjust criteria as needed

3. **Implement Ecwid Sync**
   - Complete `src/ecwid/ecwid-client.ts`
   - Add retry logic and error handling
   - Test with small batch first

4. **Production Deployment**
   - Set up monitoring and alerting
   - Configure backup strategy
   - Document operational procedures

## Troubleshooting

### Issue: Too many products passing filter
**Solution**: Add more restrictive criteria (categories, brands, price ranges)

### Issue: Supabase API errors
**Solution**: Check API key, verify table schema matches, check rate limits

### Issue: FTP connection failures
**Solution**: Verify credentials, check network connectivity, review retry logs

### Issue: Filter statistics not showing
**Solution**: Ensure logger level is set to `info` or lower

## References

- [Supabase REST API Documentation](https://supabase.com/docs/guides/api)
- [Ecwid API Documentation](https://api-docs.ecwid.com/)
- [Product Filter Guide](./FILTER_GUIDE.md)
- [Implementation Plan](./implementation.md)
