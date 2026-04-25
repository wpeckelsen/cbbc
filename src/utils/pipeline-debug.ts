import { logger } from '../logger';

function isEnabled(): boolean {
  return process.env.PIPELINE_DEBUG === '1';
}

function truncate(value: unknown, maxLen: number): unknown {
  if (typeof value === 'string') {
    if (value.length <= maxLen) return value;
    return value.slice(0, maxLen) + '…';
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

export function logBoundarySample(
  boundary: string,
  records: Array<Record<string, unknown>>,
  opts?: {
    sampleIndex?: number;
    maxKeys?: number;
    maxStringLen?: number;
  }
): void {
  if (!isEnabled()) return;

  const sampleIndex = opts?.sampleIndex ?? 0;
  const maxKeys = opts?.maxKeys ?? 200;
  const maxStringLen = opts?.maxStringLen ?? 160;

  const count = records.length;
  const sample = records[sampleIndex];

  if (!sample) {
    logger.info({ boundary, count }, 'PIPELINE_DEBUG boundary');
    return;
  }

  const keys = Object.keys(sample).sort();
  const limitedKeys = keys.slice(0, maxKeys);
  const redacted = redactRecord(sample, maxStringLen);

  logger.info(
    {
      boundary,
      count,
      keyCount: keys.length,
      keys: limitedKeys,
      sample: redacted,
      keysTruncated: keys.length > limitedKeys.length,
    },
    'PIPELINE_DEBUG boundary'
  );
}
