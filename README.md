# CBBC product pipeline

## What this is

This project is an automated pipeline that:

- Downloads product data from a supplier FTP feed (Duell)
- Cleans and checks the data for completeness
- Selects a limited set of products to publish (to keep the system manageable)
- Stores the selected products in a database (Supabase)
- Prepares the data for syncing to an online store (Ecwid)

## Why it exists

Supplier product feeds are large and often inconsistent. This pipeline turns that raw data into a smaller, reliable set of products that can be used by downstream systems.

## What goes in

The pipeline pulls multiple CSV files from an FTP server, including:

- Product catalog (products)
- Prices
- Stock levels
- Category descriptions + category hierarchy
- Product images

## What comes out

After a run, the selected products are available in Supabase as:

- **Product models** (the “main product” concept)
- **Product variants / SKUs** (the sellable items)

In other words:

- A *model* groups together related SKUs.
- A *variant/SKU* is what has its own barcode, price, stock, and image.

## What the pipeline considers “publishable”

A product variant is considered eligible when it has:

- A valid barcode
- A valid EUR price
- Stock available
- An image URL
- A brand and at least one category

The pipeline also drops variants if they conflict with their model (for example: a model where variants disagree on brand/vendor/categories).

## Important limitation (current cap)

To keep the output small during the current phase, the pipeline enforces a hard cap:

- It selects up to **50 product models** per run.
- All valid variants belonging to those selected models are included.

## How often it runs

The worker is designed to run on a schedule (cron). The exact timing is configurable and depends on the deployment.

## Store sync (Ecwid)

This repository contains the beginnings of an Ecwid sync. At the moment, the core pipeline focuses on building a clean set of models + variants in Supabase.

## Where to learn more (technical)

For implementation and architecture details (stack, data flow, tables, filtering/capping logic), see:

- `TECHNICAL_OVERVIEW.md`
