import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { config } from './config/env';

/**
 * Global fallback logger. Used by CLI scripts (`db:status`, `db:check`, …)
 * and by modules when no run-scoped logger is provided.
 *
 * Pipeline runs and Shopify pushes create a {@link RunContext} instead, which
 * provides a logger that writes to both stdout and a per-run log file.
 */
export const logger = pino(
  { level: config.logging.level },
  pinoPretty({ colorize: true }),
);