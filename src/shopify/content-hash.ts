import { createHash } from 'crypto';
import { ModelWithVariants } from '../api/products-api';

/**
 * Deterministic hashes of the Shopify-facing payload for a model.
 *
 * Split into two hashes so the push can take an inventory-only fast path when
 * only stock levels changed (skip `productSet`, only call
 * `inventorySetQuantities`).
 *
 * Product hash covers: title, vendor, tags, per-variant SKU/barcode/price/
 * name/image — everything that goes into `productSet`.
 *
 * Stock hash covers: per-variant stock_total — the only field written via
 * `inventorySetQuantities`.
 */

export type ContentHashes = {
  productHash: string;
  stockHash: string;
};

export function computeContentHashes(entry: ModelWithVariants): ContentHashes {
  const { model, variants } = entry;

  // Sort variants by product_code for deterministic ordering.
  const sorted = [...variants].sort((a, b) =>
    a.product_code.localeCompare(b.product_code),
  );

  const productPayload = {
    m: {
      name_en: model.name_en,
      vendor_name: model.vendor_name,
      category_codes: model.category_codes, // already sorted by normalizeCategoryCodes
    },
    v: sorted.map((v) => ({
      product_code: v.product_code,
      name_en: v.name_en,
      barcode: v.barcode,
      price: (Number(v.price_dkk_excl_vat) || Number(v.price_eur_excl_vat) * 7.47417).toFixed(2),
      image_url: v.image_url,
    })),
  };

  const stockPayload = {
    v: sorted.map((v) => ({
      product_code: v.product_code,
      stock: Math.max(0, Math.trunc(v.stock_total)),
    })),
  };

  return {
    productHash: sha256(JSON.stringify(productPayload)),
    stockHash: sha256(JSON.stringify(stockPayload)),
  };
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
