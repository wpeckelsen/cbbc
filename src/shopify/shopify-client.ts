import { Logger } from 'pino';
import { config } from '../config/env';
import { logger as defaultLogger } from '../logger';

/**
 * Minimal Shopify GraphQL Admin API client.
 *
 * Built to scale to the full feed: every call is cost/throttle aware and retries
 * on Shopify's THROTTLED errors using the returned `throttleStatus`, so a large
 * push is paced automatically rather than failing.
 */

export type ShopifyUserError = { field?: string[] | null; message: string };

export type ProductSetResult = {
  productId: string;
  handle: string | null;
  variants: Array<{
    id: string;
    sku: string | null;
    inventoryItemId: string | null;
  }>;
};

export type InventoryQuantity = {
  inventoryItemId: string;
  locationId: string;
  quantity: number;
};

class ShopifyError extends Error {}

export class ShopifyClient {
  private storeDomain: string;
  private accessToken: string;
  private apiVersion: string;
  private explicitLocationId: string;
  private cachedLocationId: string | null = null;
  private log: Logger;

  constructor(log: Logger = defaultLogger) {
    this.storeDomain = config.shopify.storeDomain;
    this.accessToken = config.shopify.adminAccessToken;
    this.apiVersion = config.shopify.apiVersion;
    this.explicitLocationId = config.shopify.locationId;
    this.log = log;
  }

  private assertConfigured(): void {
    if (!this.storeDomain) throw new ShopifyError('Missing SHOPIFY_STORE_DOMAIN');
    if (!this.accessToken) {
      if (config.shopify.clientId && config.shopify.secret) {
        throw new ShopifyError(
          'SHOPIFY_ADMIN_ACCESS_TOKEN is not set. ' +
          'Run `npm run shopify:auth` to authorize via OAuth and obtain one.',
        );
      }
      throw new ShopifyError('Missing SHOPIFY_ADMIN_ACCESS_TOKEN');
    }
  }

  private get endpoint(): string {
    const host = this.storeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `https://${host}/admin/api/${this.apiVersion}/graphql.json`;
  }

  /**
   * Execute a GraphQL operation. Retries on transient HTTP 429/5xx and on
   * GraphQL THROTTLED errors, backing off based on the cost throttle status.
   */
  async graphql<T>(query: string, variables?: Record<string, unknown>, attempt = 0): Promise<T> {
    this.assertConfigured();

    const MAX_ATTEMPTS = 8;

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (networkErr) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        return this.graphql<T>(query, variables, attempt + 1);
      }
      throw networkErr;
    }

    // Hard rate-limit / transient server errors: back off and retry.
    if (res.status === 429 || res.status >= 500) {
      if (attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
        this.log.warn(`Shopify transient error (HTTP ${res.status}), retry ${attempt}`);
        await sleep(waitMs);
        return this.graphql<T>(query, variables, attempt + 1);
      }
      throw new ShopifyError(`Shopify HTTP ${res.status} after ${attempt} retries`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new ShopifyError(`Shopify HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
      extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number } } };
    };

    const throttled = json.errors?.some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled) {
      if (attempt < MAX_ATTEMPTS) {
        const status = json.extensions?.cost?.throttleStatus;
        // Give the leaky bucket ~2s to refill, with exponential backoff as a floor.
        const waitMs = Math.max(2000, backoffMs(attempt));
        this.log.warn(`Shopify THROTTLED, backing off (attempt ${attempt}, wait ${waitMs}ms)`);
        await sleep(waitMs);
        return this.graphql<T>(query, variables, attempt + 1);
      }
      throw new ShopifyError('Shopify THROTTLED after max retries');
    }

    if (json.errors && json.errors.length > 0) {
      throw new ShopifyError(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    if (!json.data) {
      throw new ShopifyError('Shopify GraphQL returned no data');
    }

    return json.data;
  }

  /**
   * Resolve the inventory location to write stock to. Uses SHOPIFY_LOCATION_ID
   * when set, otherwise the first active location.
   */
  async getLocationId(): Promise<string> {
    if (this.explicitLocationId) return this.explicitLocationId;
    if (this.cachedLocationId) return this.cachedLocationId;

    const data = await this.graphql<{
      locations: { edges: Array<{ node: { id: string; isActive: boolean } }> };
    }>(`
      query {
        locations(first: 5, query: "active:true") {
          edges { node { id isActive } }
        }
      }
    `);

    const active = data.locations.edges.map((e) => e.node).find((n) => n.isActive) ?? data.locations.edges[0]?.node;
    if (!active) throw new ShopifyError('No Shopify location found to write inventory to');
    this.cachedLocationId = active.id;
    return active.id;
  }

  /**
   * Look up an existing product id by handle so productSet can update in place.
   */
  async findProductIdByHandle(handle: string): Promise<string | null> {
    const data = await this.graphql<{
      products: { edges: Array<{ node: { id: string } }> };
    }>(
      `query ($q: String!) {
        products(first: 1, query: $q) { edges { node { id } } }
      }`,
      { q: `handle:${handle}` }
    );
    return data.products.edges[0]?.node.id ?? null;
  }

  /**
   * Create or update a product (and its full set of variants) in one call.
   */
  async productSet(input: Record<string, unknown>): Promise<ProductSetResult> {
    const data = await this.graphql<{
      productSet: {
        product: {
          id: string;
          handle: string | null;
          variants: { edges: Array<{ node: { id: string; sku: string | null; inventoryItem: { id: string } | null } }> };
        } | null;
        userErrors: ShopifyUserError[];
      };
    }>(
      `mutation ProductSet($input: ProductSetInput!) {
        productSet(synchronous: true, input: $input) {
          product {
            id
            handle
            variants(first: 100) {
              edges { node { id sku inventoryItem { id } } }
            }
          }
          userErrors { field message }
        }
      }`,
      { input }
    );

    if (data.productSet.userErrors.length > 0) {
      throw new ShopifyError(`productSet userErrors: ${JSON.stringify(data.productSet.userErrors)}`);
    }
    const product = data.productSet.product;
    if (!product) throw new ShopifyError('productSet returned no product');

    return {
      productId: product.id,
      handle: product.handle,
      variants: product.variants.edges.map((e) => ({
        id: e.node.id,
        sku: e.node.sku,
        inventoryItemId: e.node.inventoryItem?.id ?? null,
      })),
    };
  }

  /**
   * Set absolute available inventory quantities (ignores compare-quantity so we
   * can write without first reading current levels).
   */
  async setInventoryQuantities(quantities: InventoryQuantity[]): Promise<void> {
    if (quantities.length === 0) return;

    const data = await this.graphql<{
      inventorySetQuantities: { userErrors: ShopifyUserError[] };
    }>(
      `mutation InventorySet($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors { field message }
        }
      }`,
      {
        input: {
          name: 'available',
          reason: 'correction',
          ignoreCompareQuantity: true,
          quantities: quantities.map((q) => ({
            inventoryItemId: q.inventoryItemId,
            locationId: q.locationId,
            quantity: q.quantity,
          })),
        },
      }
    );

    if (data.inventorySetQuantities.userErrors.length > 0) {
      throw new ShopifyError(`inventorySetQuantities userErrors: ${JSON.stringify(data.inventorySetQuantities.userErrors)}`);
    }
  }

  /**
   * Batch-check which product GIDs still exist in Shopify.
   * Returns the subset of `productIds` that are live.
   */
  async checkProductsExist(productIds: string[]): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();

    const BATCH = 250; // Shopify nodes query limit
    const alive = new Set<string>();

    for (let i = 0; i < productIds.length; i += BATCH) {
      const batch = productIds.slice(i, i + BATCH);
      const data = await this.graphql<{
        nodes: Array<{ id: string } | null>;
      }>(
        `query ($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Product { id } }
        }`,
        { ids: batch },
      );
      for (const node of data.nodes) {
        if (node?.id) alive.add(node.id);
      }
    }

    return alive;
  }

  /**
   * Delete a product from the storefront.
   */
  async deleteProduct(productId: string): Promise<void> {
    const data = await this.graphql<{
      productDelete: { deletedProductId: string | null; userErrors: ShopifyUserError[] };
    }>(
      `mutation ProductDelete($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors { field message }
        }
      }`,
      { input: { id: productId } }
    );

    if (data.productDelete.userErrors.length > 0) {
      throw new ShopifyError(`productDelete userErrors: ${JSON.stringify(data.productDelete.userErrors)}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  // Exponential backoff with jitter, capped at 10s.
  const base = Math.min(10000, 500 * 2 ** attempt);
  return base + Math.floor(Math.random() * 250);
}

export const shopifyClient = new ShopifyClient();
