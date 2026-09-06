import { Logger } from 'pino';
import { logger as defaultLogger } from '../logger';

function truncate(value: unknown, maxLen: number): unknown {
  if (typeof value === 'string') {
    if (value.length <= maxLen) return value;
    return value.slice(0, maxLen) + '\u2026';
  }
  return value;
}

function redactRecord(record: Record<string, unknown>, maxStringLen: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (Array.isArray(v)) {
      out[k] = { type: 'array', length: v.length };
      continue;
    }
    out[k] = truncate(v, maxStringLen);
  }
  return out;
}

/**
 * Log a boundary sample at **debug** level.
 *
 * Previously gated by `PIPELINE_DEBUG=1`; now fires whenever the logger's
 * level includes `debug` (always true in dev, which uses debug logging).
 */
export function logBoundarySample(
  boundary: string,
  records: Array<Record<string, unknown>>,
  opts?: {
    sampleIndex?: number;
    maxKeys?: number;
    maxStringLen?: number;
  },
  log: Logger = defaultLogger,
): void {
  if (!log.isLevelEnabled('debug')) return;

  const sampleIndex = opts?.sampleIndex ?? 0;
  const maxKeys = opts?.maxKeys ?? 200;
  const maxStringLen = opts?.maxStringLen ?? 160;

  const count = records.length;
  const sample = records[sampleIndex];

  if (!sample) {
    log.debug({ boundary, count }, 'Boundary sample (empty)');
    return;
  }

  const keys = Object.keys(sample).sort();
  const limitedKeys = keys.slice(0, maxKeys);
  const redacted = redactRecord(sample, maxStringLen);

  log.debug(
    {
      boundary,
      count,
      keyCount: keys.length,
      keys: limitedKeys,
      sample: redacted,
      keysTruncated: keys.length > limitedKeys.length,
    },
    'Boundary sample',
  );
}
