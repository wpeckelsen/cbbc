# CBBC Product Pipeline

Automated pipeline that takes raw supplier data from Duell (FTP CSV feed), validates it, selects publishable products, and syncs them to a Shopify storefront.

## Stack

- **Runtime**: Node.js >= 20, TypeScript
- **Database**: PostgreSQL (hosted on Railway)
- **Supplier data**: FTP CSV files from Duell
- **Storefront**: Shopify (GraphQL Admin API)
- **Scheduling**: `node-cron`
- **Hosting**: Railway (worker service + Postgres)

## Quick start (local dev)

```bash
npm install
cp .env.example .env        # fill in FTP, DB, and Shopify credentials
npm run db:migrate           # create tables on your target DB
npm run dev                  # runs pipeline immediately, then Shopify push
```

## Build and run (production)

```bash
npm run build                # tsc -> dist/
npm start                    # node dist/worker.js — registers cron, sits idle
```

On Railway, the service runs `node dist/worker.js`. It registers cron jobs and waits for the schedule. See [PIPELINE_GUIDE.md](./PIPELINE_GUIDE.md) for full deployment and configuration details.

## What the pipeline does

1. Downloads 6 CSV files from the supplier FTP
2. Parses, normalizes, and enriches product rows (joins prices, stock, images)
3. Validates products for completeness (barcode, price, stock, image, brand, categories)
4. Caps output to a configurable number of models
5. Writes to staging tables, then promotes to production tables
6. Pushes promoted products to Shopify (models become products, variants become SKUs)

## Documentation

| Document | Purpose |
|----------|---------|
| [PIPELINE_GUIDE.md](./PIPELINE_GUIDE.md) | How to operate the pipeline: env vars, commands, deployment, external tools |
| [TECHNICAL_OVERVIEW.md](./TECHNICAL_OVERVIEW.md) | Deep dive: data flow, table schema, filtering/capping logic, Shopify mapping |
| `.env.example` | All configurable environment variables with comments |
