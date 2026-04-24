Build a TypeScript-based scheduled service that runs inside a Docker container.

The service must:

* Connect to a legacy FTP server (untrusted source)
* Download product data daily
* Perform strict validation (sanity checks)
* Store cleaned data in a database (to be designed)
* Sync validated products to an Ecwid storefront via API

This system acts as a data pipeline with staging and validation safety layers.

Runtime environment:

* Runs as a single Docker container
* Long-running worker process (not a web server)
* Execution is triggered via an internal cron job inside the container
* Logs are written to stdout and stderr for container logging systems

Key constraints and assumptions:

* FTP server is unreliable and potentially unsafe
* Data is non-sensitive but must be validated
* System must be idempotent (safe to re-run)
* No direct write from FTP to storefront; always use an intermediate database
* Runs once per day via cron
* Must be safe to restart at any time (stateless execution model)

High-level architecture:

FTP Server
→ Dockerized TypeScript Worker
→ Validation Layer
→ Database (staging → production)
→ Ecwid API Sync

Execution model:

Inside the Docker container:

* Application starts
* Cron scheduler initializes
* Daily job runs:

  * Fetch FTP data
  * Parse and validate
  * Store data in staging database
  * Run sanity checks
  * Promote data to production database
  * Sync products to Ecwid API
* Logs are written to container stdout

Reliability requirements:

* Safe to re-run without duplicating data
* Handles partial failures gracefully
* Never writes unvalidated data to production tables
* Retries network operations (FTP and API calls)
