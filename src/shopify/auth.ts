import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';

/**
 * One-time OAuth authorization flow for Shopify.
 *
 * Uses the Client ID + Secret to obtain an Admin API access token via the
 * OAuth authorization code grant. The resulting token is appended to `.env`
 * so the pipeline can use it for all subsequent runs.
 *
 * Usage:
 *   npm run shopify:auth
 *
 * Prerequisites in .env:
 *   SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
 *   SHOPIFY_CLIENT_ID=...
 *   SHOPIFY_SECRET=...
 */

const REQUIRED_SCOPES = [
  'write_inventory',
  'read_inventory',
  'write_locations',
  'read_locations',
  'read_products',
  'write_products',
  'read_publications',
  'write_publications',
].join(',');

const CALLBACK_PORT = 3456;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

function assertConfigured(): void {
  if (!config.shopify.storeDomain) {
    throw new Error('Missing SHOPIFY_STORE_DOMAIN in .env');
  }
  if (!config.shopify.clientId) {
    throw new Error('Missing SHOPIFY_CLIENT_ID in .env');
  }
  if (!config.shopify.secret) {
    throw new Error('Missing SHOPIFY_SECRET in .env');
  }
}

function shopHost(): string {
  return config.shopify.storeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function buildAuthorizationUrl(nonce: string): string {
  const params = new URLSearchParams({
    client_id: config.shopify.clientId,
    scope: REQUIRED_SCOPES,
    redirect_uri: REDIRECT_URI,
    state: nonce,
  });
  return `https://${shopHost()}/admin/oauth/authorize?${params}`;
}

function verifyHmac(query: URLSearchParams): boolean {
  const hmac = query.get('hmac');
  if (!hmac) return false;

  // Build the message from all query params except hmac, sorted alphabetically.
  const entries = Array.from(query.entries())
    .filter(([key]) => key !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b));

  const message = entries.map(([k, v]) => `${k}=${v}`).join('&');
  const digest = crypto
    .createHmac('sha256', config.shopify.secret)
    .update(message)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const url = `https://${shopHost()}/admin/oauth/access_token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.shopify.clientId,
      client_secret: config.shopify.secret,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token?: string; scope?: string };
  if (!data.access_token) {
    throw new Error('Shopify returned no access_token');
  }

  console.log(`Granted scopes: ${data.scope}`);
  return data.access_token;
}

function writeTokenToEnv(token: string): void {
  const envPath = path.resolve(process.cwd(), '.env');
  let content = '';

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  // Replace existing token line or append.
  const tokenLine = `SHOPIFY_ADMIN_ACCESS_TOKEN=${token}`;
  if (/^SHOPIFY_ADMIN_ACCESS_TOKEN=.*/m.test(content)) {
    content = content.replace(/^SHOPIFY_ADMIN_ACCESS_TOKEN=.*/m, tokenLine);
  } else {
    content = content.trimEnd() + '\n' + tokenLine + '\n';
  }

  fs.writeFileSync(envPath, content, 'utf8');
  console.log(`Access token written to ${envPath}`);
}

async function run(): Promise<void> {
  assertConfigured();

  if (config.shopify.adminAccessToken) {
    console.log('SHOPIFY_ADMIN_ACCESS_TOKEN is already set in .env.');
    console.log('To re-authorize, remove the line from .env and run this again.');
    process.exit(0);
  }

  const nonce = crypto.randomBytes(16).toString('hex');

  const tokenPromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      const query = url.searchParams;

      // Verify state to prevent CSRF.
      if (query.get('state') !== nonce) {
        res.writeHead(400);
        res.end('State mismatch — possible CSRF. Please try again.');
        reject(new Error('OAuth state mismatch'));
        server.close();
        return;
      }

      // Verify HMAC.
      if (!verifyHmac(query)) {
        res.writeHead(400);
        res.end('HMAC verification failed.');
        reject(new Error('HMAC verification failed'));
        server.close();
        return;
      }

      const code = query.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code.');
        reject(new Error('No code in callback'));
        server.close();
        return;
      }

      try {
        const token = await exchangeCodeForToken(code);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h2>Authorization successful!</h2>' +
          '<p>You can close this window. The access token has been saved to <code>.env</code>.</p>' +
          '</body></html>',
        );
        resolve(token);
      } catch (err) {
        res.writeHead(500);
        res.end(`Token exchange failed: ${(err as Error).message}`);
        reject(err);
      } finally {
        server.close();
      }
    });

    server.listen(CALLBACK_PORT, () => {
      const authUrl = buildAuthorizationUrl(nonce);
      console.log('\n=== Shopify OAuth Authorization ===\n');
      console.log('Open this URL in your browser to authorize the app:\n');
      console.log(`  ${authUrl}\n`);
      console.log(`Waiting for callback on http://localhost:${CALLBACK_PORT}/callback ...\n`);
    });

    server.on('error', reject);
  });

  const token = await tokenPromise;
  writeTokenToEnv(token);
  console.log('\nDone! You can now run the Shopify push:');
  console.log('  npm run shopify:push:prod');
}

run().catch((err) => {
  console.error(`\nAuthorization failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
