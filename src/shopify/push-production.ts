import * as cron from 'node-cron';
import { config } from '../config/env';
import { logger } from '../logger';
import {
  getPromotedModelsWithVariants,
  getAllStoreProductLinks,
  upsertStoreProductLink,
  upsertStoreVariantLink,
  deleteStoreProductLink,
  updateModelSyncStatus,
  logStoreSync,
  ModelWithVariants,
} from '../api/products-api';
import { shopifyClient, InventoryQuantity } from './shopify-client';
import { buildProductSetInput, handleForModel } from './mappers';

type PushSummary = {
  upserted: number;
  variantsSynced: number;
  deleted: number;
  failed: number;
};

/**
 * Push the promoted Supabase catalogue to Shopify.
 *
 * - Upserts every promoted model as a Shopify product (+ grouped variants) via
 *   `productSet`, keyed by a deterministic handle so re-runs update in place.
 * - Writes inventory for each variant to a single location.
 * - Reconciles deletions: any previously-pushed model no longer present in the
 *   promoted set is hard-deleted from Shopify and from the local link tables.
 *
 * Built to scale to the full feed: the catalogue is read with pagination and the
 * Shopify client is throttle-aware, so large runs pace themselves.
 */
export async function runShopifyPush(): Promise<PushSummary> {
  if (!config.shopify.storeDomain || !config.shopify.adminAccessToken) {
    throw new Error('Shopify is not configured (set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN)');
  }

  const summary: PushSummary = { upserted: 0, variantsSynced: 0, deleted: 0, failed: 0 };

  const locationId = await shopifyClient.getLocationId();
  logger.info('Resolved Shopify inventory location', { locationId });

  const [entries, existingLinks] = await Promise.all([
    getPromotedModelsWithVariants(),
    getAllStoreProductLinks(),
  ]);

  const linkByModel = new Map(existingLinks.map((l) => [l.model_code, l]));
  const currentModelCodes = new Set(entries.map((e) => e.model.model_code));

  logger.info('Starting Shopify push', {
    promotedModels: entries.length,
    knownLinks: existingLinks.length,
  });

  // --- Upserts ---
  for (const entry of entries) {
    try {
      await upsertModel(entry, linkByModel.get(entry.model.model_code)?.external_product_id ?? null, locationId, summary);
    } catch (error) {
      summary.failed++;
      const err = error as Error;
      logger.error('Failed to upsert model to Shopify', { modelCode: entry.model.model_code, error: err.message });
      await logStoreSync({
        scope: 'product',
        local_code: entry.model.model_code,
        action: 'update',
        status: 'failed',
        message: err.message,
      });
    }
  }

  // --- Reconcile deletions ---
  for (const link of existingLinks) {
    if (currentModelCodes.has(link.model_code)) continue;
    try {
      await shopifyClient.deleteProduct(link.external_product_id);
      await deleteStoreProductLink(link.model_code);
      summary.deleted++;
      await logStoreSync({
        scope: 'product',
        local_code: link.model_code,
        external_id: link.external_product_id,
        action: 'delete',
        status: 'success',
      });
    } catch (error) {
      summary.failed++;
      const err = error as Error;
      logger.error('Failed to delete stale Shopify product', { modelCode: link.model_code, error: err.message });
      await logStoreSync({
        scope: 'product',
        local_code: link.model_code,
        external_id: link.external_product_id,
        action: 'delete',
        status: 'failed',
        message: err.message,
      });
    }
  }

  logger.info('Shopify push complete', summary);
  return summary;
}

async function upsertModel(
  entry: ModelWithVariants,
  knownProductId: string | null,
  locationId: string,
  summary: PushSummary
): Promise<void> {
  const modelCode = entry.model.model_code;
  const handle = handleForModel(modelCode);

  // Prefer the stored id; otherwise look up by handle to adopt any product that
  // already exists in Shopify (e.g. created by a previous run before linking).
  const existingId = knownProductId ?? (await shopifyClient.findProductIdByHandle(handle));

  const input = buildProductSetInput(entry, existingId);
  const result = await shopifyClient.productSet(input);

  await upsertStoreProductLink({
    model_code: modelCode,
    external_product_id: result.productId,
    external_handle: result.handle,
  });

  // Match returned Shopify variants back to our variants by SKU to capture ids
  // and build inventory updates.
  const variantBySku = new Map(result.variants.map((v) => [v.sku, v]));
  const inventoryUpdates: InventoryQuantity[] = [];

  for (const v of entry.variants) {
    const shopifyVariant = variantBySku.get(v.product_code);
    if (!shopifyVariant) {
      logger.warn('Shopify did not return a variant for SKU', { modelCode, sku: v.product_code });
      continue;
    }

    await upsertStoreVariantLink({
      product_code: v.product_code,
      model_code: modelCode,
      external_variant_id: shopifyVariant.id,
      external_inventory_item_id: shopifyVariant.inventoryItemId,
    });

    if (shopifyVariant.inventoryItemId) {
      inventoryUpdates.push({
        inventoryItemId: shopifyVariant.inventoryItemId,
        locationId,
        quantity: Math.max(0, Math.trunc(v.stock_total)),
      });
    }
    summary.variantsSynced++;
  }

  await shopifyClient.setInventoryQuantities(inventoryUpdates);

  await updateModelSyncStatus(modelCode, new Date());
  summary.upserted++;

  await logStoreSync({
    scope: 'product',
    local_code: modelCode,
    external_id: result.productId,
    action: existingId ? 'update' : 'create',
    status: 'success',
  });
}

// Optional weekly schedule (e.g. SHOPIFY_PUSH_CRON='0 3 * * 1' = Mon 03:00).
// Disabled by default — the push runs manually via `npm run shopify:push:prod`.
if (config.nodeEnv !== 'test' && config.shopify.pushCron) {
  cron.schedule(config.shopify.pushCron, async () => {
    try {
      await runShopifyPush();
    } catch (error) {
      const err = error as Error;
      logger.error('Scheduled Shopify push failed', { error: err.message });
    }
  });
  logger.info('Shopify push cron scheduled', { schedule: config.shopify.pushCron });
}

if (require.main === module) {
  runShopifyPush().catch((error) => {
    const err = error as Error;
    logger.error('Shopify production push failed', { error: err.message, stack: err.stack });
    process.exitCode = 1;
  });
}
