# Email notifications — implementation plan

Send a copy of each pipeline run log and Shopify push log by email using
[Resend](https://resend.com).

## Overview

Both `runPipeline` (worker.ts) and `runShopifyPush` (push-production.ts) already
produce a human-readable log file via `RunContext`. After a run finishes
(success **or** failure), the log file is read from disk and emailed to the
configured recipient(s).

Email sending is **opt-in** — controlled by `EMAIL_ENABLED` in `.env`. If the
key is missing or falsy, no email code runs.

---

## 1. Install dependency

```bash
npm install resend
```

`resend` is the only new dependency (tiny, zero sub-deps).

---

## 2. Environment variables

All email config lives in `.env` (see `.env.example` for the template).

| Variable | Required | Default | Description |
|---|---|---|---|
| `EMAIL_ENABLED` | no | `false` | Master switch. Set to `true` to enable email notifications. |
| `RESEND_API_KEY` | yes (when enabled) | — | Resend API key (`re_...`). |
| `EMAIL_FROM` | no | `CBBC Pipeline <noreply@resend.dev>` | Sender address. Must be a verified domain in Resend, or use `@resend.dev` for testing. |
| `EMAIL_TO` | yes (when enabled) | — | Recipient address(es), comma-separated for multiple. |
| `EMAIL_ON_SUCCESS` | no | `true` | Send email on successful runs. |
| `EMAIL_ON_FAILURE` | no | `true` | Send email on failed runs. |

---

## 3. Config changes (`src/config/env.ts`)

Add a new `email` block to the exported `config` object:

```ts
email: {
  enabled: parseBooleanEnv(process.env.EMAIL_ENABLED, false),
  resendApiKey: process.env.RESEND_API_KEY || '',
  from: process.env.EMAIL_FROM || 'CBBC Pipeline <noreply@resend.dev>',
  to: (process.env.EMAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  onSuccess: parseBooleanEnv(process.env.EMAIL_ON_SUCCESS, true),
  onFailure: parseBooleanEnv(process.env.EMAIL_ON_FAILURE, true),
},
```

---

## 4. New module: `src/email/send-run-log.ts`

Single exported function:

```ts
import { Resend } from 'resend';
import fs from 'fs';
import { config } from '../config/env';
import { RunContext, RunType } from '../logging';
import { Logger } from 'pino';

export async function sendRunLog(
  run: RunContext,
  status: 'success' | 'failed',
  log: Logger,
): Promise<void> {
  const cfg = config.email;

  // Guard: email disabled or not configured
  if (!cfg.enabled) return;
  if (!cfg.resendApiKey || cfg.to.length === 0) {
    log.warn('Email enabled but RESEND_API_KEY or EMAIL_TO is missing — skipping');
    return;
  }

  // Respect per-status toggles
  if (status === 'success' && !cfg.onSuccess) return;
  if (status === 'failed' && !cfg.onFailure) return;

  const resend = new Resend(cfg.resendApiKey);

  // Build subject
  const icon = status === 'success' ? '✓' : '✗';
  const typeLabel = run.type === 'pipeline' ? 'Pipeline run' : 'Shopify push';
  const subject = `${icon} ${typeLabel} ${run.runId} — ${status.toUpperCase()}`;

  // Read the log file
  const logContent = fs.existsSync(run.logFilePath)
    ? fs.readFileSync(run.logFilePath, 'utf-8')
    : '(log file not found)';

  await resend.emails.send({
    from: cfg.from,
    to: cfg.to,
    subject,
    text: logContent,
    attachments: [
      {
        filename: `${run.runId}.log`,
        content: Buffer.from(logContent, 'utf-8'),
      },
    ],
  });

  log.info(`Run log emailed to ${cfg.to.join(', ')}`);
}
```

### Design notes

- The full log is included as both plain-text body **and** a `.log` attachment
  (so the email is readable in the inbox, and the attachment preserves
  formatting for archival).
- `Resend` is instantiated per call (no global singleton) — runs are infrequent
  so there's no performance concern.
- Errors from `resend.emails.send()` bubble up to the caller, which wraps them
  in a try/catch (see step 5).

---

## 5. Hook into the run flows

### `src/worker.ts` — after `run.finish()`

```ts
import { sendRunLog } from './email/send-run-log';

// ... inside runPipeline(), after the existing run.finish() calls:

// In the success path (around line 387-389):
await run.finish('success', {
  summary: { models: pipelineModels, variants: pipelineVariants },
});
try { await sendRunLog(run, 'success', log); } catch (e) {
  log.warn({ error: (e as Error).message }, 'Failed to send run log email');
}

// In the catch block (around line 391-394):
await run.finish('failed', { error: err });
try { await sendRunLog(run, 'failed', log); } catch (e) {
  log.warn({ error: (e as Error).message }, 'Failed to send run log email');
}
```

### `src/shopify/push-production.ts` — after `run.finish()`

Same pattern:

```ts
import { sendRunLog } from '../email/send-run-log';

// Success path (around line 168-177):
await run.finish('success', { summary: { ... } });
try { await sendRunLog(run, 'success', log); } catch (e) {
  log.warn({ error: (e as Error).message }, 'Failed to send run log email');
}

// Failure path (around line 178-183):
await run.finish('failed', { error: err });
try { await sendRunLog(run, 'failed', log); } catch (e) {
  log.warn({ error: (e as Error).message }, 'Failed to send run log email');
}
```

**Key rule**: email failures are caught and logged as warnings — they must
**never** crash the pipeline or change its exit status.

---

## 6. Email format — what the recipient sees

**Subject examples:**
- `✓ Pipeline run p-20260615-143022-a1b2 — SUCCESS`
- `✗ Shopify push s-20260615-150500-c3d4 — FAILED`

**Body** (plain text): the full log file content, which already includes:
```
════════════════════════════════════════════════════════════
  Run     : p-20260615-143022-a1b2
  Type    : pipeline
  Started : 15/06/2026 14:30:22
  Level   : info
════════════════════════════════════════════════════════════

[14:30:22] INFO  Starting FTP product pipeline
[14:30:23] INFO  Downloaded 6 CSV files (0 from cache)
...
[14:31:05] INFO  Pipeline completed successfully

════════════════════════════════════════════════════════════
  Status   : SUCCESS
  Duration : 43.2s
  Models   : 50
  Variants : 127
════════════════════════════════════════════════════════════
```

**Attachment**: `p-20260615-143022-a1b2.log` (same content as body).

---

## 7. Resend setup (one-time)

1. Sign up at [resend.com](https://resend.com) and grab your API key.
2. (Optional) Verify a custom sending domain in the Resend dashboard for
   branded `EMAIL_FROM`. The default `@resend.dev` domain works immediately
   for testing.
3. Copy `.env.example` email section into `.env` and fill in the values.

---

## 8. Files changed (summary)

| File | Change |
|---|---|
| `package.json` | Add `resend` dependency |
| `.env.example` | Add `EMAIL_*` + `RESEND_API_KEY` vars |
| `src/config/env.ts` | Add `email` config block |
| `src/email/send-run-log.ts` | **New file** — `sendRunLog()` |
| `src/worker.ts` | Import + call `sendRunLog` after `run.finish()` |
| `src/shopify/push-production.ts` | Import + call `sendRunLog` after `run.finish()` |

---

## 9. Testing checklist

- [ ] Set `EMAIL_ENABLED=true` in `.env` with valid `RESEND_API_KEY` and
      `EMAIL_TO`.
- [ ] Run the pipeline (`npm run dev` or `npm start`) — confirm email arrives
      with the full log.
- [ ] Run `npm run shopify:push:prod` — confirm email arrives.
- [ ] Simulate a failure (e.g. bad FTP creds) — confirm failure email arrives
      with error in the log.
- [ ] Set `EMAIL_ON_SUCCESS=false` — confirm success runs don't email, failures
      still do.
- [ ] Set `EMAIL_ENABLED=false` — confirm no emails are sent.
- [ ] Remove `RESEND_API_KEY` with `EMAIL_ENABLED=true` — confirm a warning is
      logged and no crash occurs.
