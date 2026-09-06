export type TraceOutcome = 'passed' | 'rejected';

export interface TraceStep {
  stage: string;
  outcome: TraceOutcome;
  reason?: string;
  details?: unknown;
}

export interface ProductTraceInput {
  product_code: string;
  model_code?: string;
  barcode?: string;
  vendor_name?: string;
  name_en?: string;
}

export interface ProductTraceRow {
  run_id: string;
  product_code: string;
  model_code?: string;
  barcode?: string;
  vendor_name?: string;
  name_en?: string;
  status: 'promoted' | 'rejected';
  journey: TraceStep[];
}

/**
 * Accumulates a per-product pipeline trace in memory during a run, keyed by
 * product code. Each product gets a single row whose `journey` records where
 * it was rejected (or that it was promoted). Flush via `toRows()` and insert
 * into `product_pipeline_status` at the end of the run.
 */
export class TraceRecorder {
  private readonly runId: string;
  private readonly byCode = new Map<string, ProductTraceRow>();

  constructor(runId: string) {
    this.runId = runId;
  }

  private rowFor(input: ProductTraceInput): ProductTraceRow {
    let row = this.byCode.get(input.product_code);
    if (!row) {
      row = {
        run_id: this.runId,
        product_code: input.product_code,
        model_code: input.model_code,
        barcode: input.barcode,
        vendor_name: input.vendor_name,
        name_en: input.name_en,
        status: 'rejected',
        journey: [],
      };
      this.byCode.set(input.product_code, row);
    } else {
      // Enrich identity fields if a later stage provides more info.
      if (input.model_code) row.model_code = input.model_code;
      if (input.barcode) row.barcode = input.barcode;
      if (input.vendor_name) row.vendor_name = input.vendor_name;
      if (input.name_en) row.name_en = input.name_en;
    }
    return row;
  }

  reject(input: ProductTraceInput, stage: string, reason: string, details?: unknown): void {
    const row = this.rowFor(input);
    row.journey.push({
      stage,
      outcome: 'rejected',
      reason,
      ...(details !== undefined ? { details } : {}),
    });
  }

  promote(input: ProductTraceInput): void {
    const row = this.rowFor(input);
    row.status = 'promoted';
    row.journey.push({ stage: 'promoted', outcome: 'passed' });
  }

  toRows(): ProductTraceRow[] {
    return Array.from(this.byCode.values());
  }
}
