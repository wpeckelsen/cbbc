import { config } from '../config/env';
import { logger } from '../logger';

/**
 * Ecwid API Client
 * 
 * This is a placeholder for future Ecwid integration.
 * Will be implemented when ready to sync products to Ecwid storefront.
 */
export class EcwidClient {
  private storeId: string;
  private apiToken: string;
  private baseUrl: string;

  constructor() {
    this.storeId = config.ecwid.storeId;
    this.apiToken = config.ecwid.apiToken;
    this.baseUrl = config.ecwid.apiBaseUrl;
  }

  private get normalizedBaseUrl(): string {
    return this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
  }

  private get authHeader(): string {
    return `Bearer ${this.apiToken}`;
  }

  private assertConfigured(): void {
    if (!this.apiToken) throw new Error('Missing ECWID_SECRET_TOKEN');
    if (!this.baseUrl) throw new Error('Missing ECWID_API_BASE_URL');
  }

  private async request<T>(path: string, opts: { method: string; body?: any }): Promise<T> {
    this.assertConfigured();

    const url = `${this.normalizedBaseUrl}${path}`;
    const res = await fetch(url, {
      method: opts.method,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Ecwid API error: ${res.status} ${res.statusText} - ${text}`);
    }

    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async batchCreateProducts(products: Array<{ productCode: string; name: string; price: number; sku: string }>): Promise<Array<{ productCode: string; status: 'success' | 'failed'; ecwidItemId?: string; message?: string }>> {
    if (products.length === 0) return [];

    const payload = {
      requests: products.map((p) => ({
        path: '/products',
        method: 'POST',
        body: {
          name: p.name,
          price: p.price,
          sku: p.sku,
        },
      })),
    };

    const response = await this.request<any>('/batch?allowParallelMode=true', { method: 'POST', body: payload });

    const responses: any[] = Array.isArray(response)
      ? response
      : Array.isArray(response?.responses)
        ? response.responses
        : Array.isArray(response?.results)
          ? response.results
          : [];

    if (responses.length === 0) {
      logger.warn('Unexpected Ecwid batch response shape', { response });
    }

    return products.map((p, idx) => {
      const r = responses[idx];
      const statusCode = r?.statusCode ?? r?.status ?? r?.code;
      const ok = typeof statusCode === 'number' ? statusCode >= 200 && statusCode < 300 : false;
      const body = r?.body ?? r?.result ?? r;
      const ecwidId = body?.id ?? body?.productId ?? body?.product_id;

      if (ok) {
        return { productCode: p.productCode, status: 'success', ecwidItemId: ecwidId !== undefined ? String(ecwidId) : undefined };
      }

      const message = r?.errorMessage ?? r?.message ?? (typeof body === 'string' ? body : JSON.stringify(body ?? r));
      return { productCode: p.productCode, status: 'failed', message };
    });
  }

  /**
   * Sync a product to Ecwid
   * @param product - Product data to sync
   * @returns Ecwid product ID
   */
  async syncProduct(product: any): Promise<string> {
    // TODO: Implement Ecwid product sync
    logger.info('Ecwid sync not yet implemented', { productCode: product.product_code });
    throw new Error('Ecwid sync not yet implemented');
  }

  /**
   * Batch sync products to Ecwid
   * @param products - Array of products to sync
   */
  async batchSyncProducts(products: any[]): Promise<void> {
    // TODO: Implement batch sync with retry logic
    logger.info('Ecwid batch sync not yet implemented', { count: products.length });
    throw new Error('Ecwid batch sync not yet implemented');
  }

  /**
   * Update product in Ecwid
   * @param ecwidId - Ecwid product ID
   * @param updates - Product updates
   */
  async updateProduct(ecwidId: string, updates: any): Promise<void> {
    // TODO: Implement product update
    logger.info('Ecwid update not yet implemented', { ecwidId });
    throw new Error('Ecwid update not yet implemented');
  }

  /**
   * Delete product from Ecwid
   * @param ecwidId - Ecwid product ID
   */
  async deleteProduct(ecwidId: string): Promise<void> {
    // TODO: Implement product deletion
    logger.info('Ecwid delete not yet implemented', { ecwidId });
    throw new Error('Ecwid delete not yet implemented');
  }
}

export const ecwidClient = new EcwidClient();
