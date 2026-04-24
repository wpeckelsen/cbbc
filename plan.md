TL;DR: Build a Dockerized TypeScript worker that fetches product data from FTP daily, validates strictly, stores in PostgreSQL (staging → production tables), then syncs to Ecwid. Runs via internal cron, idempotent and safe to restart. Retries network failures with exponential backoff; fails entire job on critical errors.

Steps (3 major phases)
Phase 1: Project Setup (Steps 1–3)

Initialize TypeScript project with dependencies (ts-node, node-cron, pg, pino)
Docker & environment setup (.env for FTP credentials, API keys, database URL)
PostgreSQL connection pool configuration

Phase 2: Data Flow (Steps 4–9)

Create PostgreSQL schema: products_staging (raw), products (validated), ecwid_sync_logs (tracking)
Implement FTP client with exponential backoff retry (max 3 attempts)
Parse FTP data and validate (price > 0, non-empty SKU, name, category, SQL injection checks)
Store in staging table, then promote to production (deduped by SKU)

Phase 3: Sync & Orchestration (Steps 10–14)

Implement Ecwid API client with retry logic
Orchestrate full pipeline in worker.ts (fetch → parse → validate → staging → production → sync)
Set up node-cron for daily execution with transaction-wrapped phases
Error handling: rollback on failure, graceful shutdown, structured logging to stdout

Phase 4: Testing & Deployment (Steps 15–16)

Unit/integration tests (validation, dedup, retry logic)
Docker build + docker-compose with PostgreSQL