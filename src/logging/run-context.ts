import pino, { Logger } from 'pino';
import pinoPretty from 'pino-pretty';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Writable } from 'stream';

const LOGS_DIR = path.resolve(process.cwd(), 'logs');

export type RunType = 'pipeline' | 'shopify-push';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRunId(prefix: string): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = crypto.randomBytes(2).toString('hex');
  return `${prefix}-${ts}-${rand}`;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

// ---------------------------------------------------------------------------
// File log stream — writes clean, human-readable lines
// ---------------------------------------------------------------------------

const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

const SKIP_KEYS = new Set(['time', 'level', 'msg', 'pid', 'hostname', 'runId', 'name', 'v']);

class FileLogStream extends Writable {
  private ws: fs.WriteStream;

  constructor(filePath: string) {
    super();
    this.ws = fs.createWriteStream(filePath, { flags: 'a' });
  }

  override _write(
    chunk: Buffer,
    _encoding: string,
    cb: (error?: Error | null) => void,
  ): void {
    try {
      const raw = chunk.toString().trim();
      if (!raw) {
        cb();
        return;
      }
      const obj = JSON.parse(raw) as Record<string, unknown>;
      this.ws.write(this.formatLine(obj) + '\n', cb);
    } catch {
      cb();
    }
  }

  /** Write raw text (headers / footers) bypassing JSON parsing. */
  writeRaw(text: string): void {
    this.ws.write(text);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.ws.end(resolve));
  }

  // -- formatting ----------------------------------------------------------

  private formatLine(obj: Record<string, unknown>): string {
    const time = typeof obj.time === 'number'
      ? new Date(obj.time).toLocaleTimeString('en-GB', { hour12: false })
      : '??:??:??';
    const level = LEVEL_LABELS[obj.level as number] ?? 'INFO';
    const msg = (obj.msg as string) ?? '';

    const extra: [string, unknown][] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (!SKIP_KEYS.has(k)) extra.push([k, v]);
    }

    let line = `[${time}] ${level.padEnd(5)} ${msg}`;

    if (extra.length > 0 && extra.length <= 6) {
      const parts = extra.map(([k, v]) => `${k}=${formatValue(v)}`);
      line += `  (${parts.join(', ')})`;
    } else if (extra.length > 6) {
      // Many keys — put on next lines to avoid one enormous line
      for (const [k, v] of extra) {
        line += `\n           ${k}: ${formatValue(v)}`;
      }
    }

    return line;
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.length <= 8) return JSON.stringify(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// RunContext
// ---------------------------------------------------------------------------

export class RunContext {
  readonly runId: string;
  readonly type: RunType;
  readonly startedAt: Date;
  readonly logFilePath: string;
  readonly log: Logger;

  private fileStream: FileLogStream;
  private finished = false;

  constructor(type: RunType, level?: string) {
    this.type = type;
    this.startedAt = new Date();

    const prefix = type === 'pipeline' ? 'p' : 's';
    this.runId = generateRunId(prefix);

    const effectiveLevel = level ?? process.env.LOG_LEVEL ?? 'info';

    // Ensure logs/ exists
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    // File name: type_YYYY-MM-DD_HH-MM-SS_shortId.log
    const ts = this.startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const shortId = this.runId.split('-').pop()!;
    this.logFilePath = path.join(LOGS_DIR, `${type}_${ts}_${shortId}.log`);

    // File stream
    this.fileStream = new FileLogStream(this.logFilePath);
    this.writeHeader(effectiveLevel);

    // Stdout stream (pino-pretty)
    const stdoutStream = pinoPretty({ colorize: true });

    // Multistream → stdout + file
    this.log = pino(
      { level: effectiveLevel },
      pino.multistream([
        { stream: stdoutStream, level: effectiveLevel as pino.Level },
        { stream: this.fileStream, level: effectiveLevel as pino.Level },
      ]),
    ).child({ runId: this.runId });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async finish(
    status: 'success' | 'failed',
    opts?: { summary?: Record<string, unknown>; error?: Error },
  ): Promise<void> {
    if (this.finished) return;
    this.finished = true;

    const endedAt = new Date();
    const duration = formatDuration(endedAt.getTime() - this.startedAt.getTime());

    this.log.flush();

    // Small delay so buffered writes reach the file
    await new Promise((r) => setTimeout(r, 50));

    this.writeFooter(status, duration, opts?.summary, opts?.error);
    await this.fileStream.close();
  }

  // -----------------------------------------------------------------------
  // Header / footer
  // -----------------------------------------------------------------------

  private writeHeader(level: string): void {
    const div = '\u2550'.repeat(60);
    this.fileStream.writeRaw(
      `${div}\n` +
        `  Run     : ${this.runId}\n` +
        `  Type    : ${this.type}\n` +
        `  Started : ${formatTimestamp(this.startedAt)}\n` +
        `  Level   : ${level}\n` +
        `${div}\n\n`,
    );
  }

  private writeFooter(
    status: string,
    duration: string,
    summary?: Record<string, unknown>,
    error?: Error,
  ): void {
    const div = '\u2550'.repeat(60);
    let footer = `\n${div}\n`;
    footer += `  Status   : ${status.toUpperCase()}\n`;
    footer += `  Duration : ${duration}\n`;

    if (error) {
      footer += `  Error    : ${error.message}\n`;
    }

    if (summary) {
      for (const [k, v] of Object.entries(summary)) {
        const label = k.charAt(0).toUpperCase() + k.slice(1);
        footer += `  ${label.padEnd(9)}: ${v}\n`;
      }
    }

    footer += `${div}\n`;
    this.fileStream.writeRaw(footer);
  }
}
