import * as cron from 'node-cron';
import { Logger } from 'pino';
import { config } from '../config/env';
import { logger } from '../logger';
import {
  configureProductsApi,
  getPromotedModelsWithVariants,
  getAllStoreProductLinks,
  upsertStoreProductLink,
  upsertStoreVariantLink,
  deleteStoreProductLink,
  updateModelSyncStatus,
  logStoreSync,
  ModelWithVariants,
} from '../api/products-api';
import { ShopifyClient, shopifyClient as defaultShopifyClient, InventoryQuantity } from './shopify-client';
import { SupabaseClient } from '../api/supabase-client';
import { buildProductSetInput, handleForModel } from './mappers';
import { RunContext } from '../logging';
import { checkDrift } from '../db/drift-check';

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

  const run = new RunContext('shopify-push');
  const log: Logger = run.log;

  // Wire modules to the run logger
  const shopify = new ShopifyClient(log);
  const supabase = new SupabaseClient(log);
  configureProductsApi(log, supabase);

  const summary: PushSummary = { upserted: 0, variantsSynced: 0, deleted: 0, failed: 0 };

  try {
    // Pre-run: DB drift check
    await checkDrift(log);

    const locationId = await shopify.getLocationId();
    log.info(`Resolved Shopify inventory location (${locationId})`);

    const [entries, existingLinks] = await Promise.all([
      getPromotedModelsWithVariants(),
      getAllStoreProductLinks(),
    ]);

    const linkByModel = new Map(existingLinks.map((l) => [l.model_code, l]));
    const currentModelCodes = new Set(entries.map((e) => e.model.model_code));

    log.info(`Starting Shopify push (${entries.length} promoted models, ${existingLinks.length} existing links)`);

    // --- Upserts ---
    for (const entry of entries) {
      try {
        await upsertModel(entry, linkByModel.get(entry.model.model_code)?.external_product_id ?? null, locationId, summary, shopify, log);
      } catch (error) {
        summary.failed++;
        const err = error as Error;
        log.error(`Failed to upsert model ${entry.model.model_code} to Shopify (${err.message})`);
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
        await shopify.deleteProduct(link.external_product_id);
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
        log.error(`Failed to delete stale Shopify product ${link.model_code} (${err.message})`);
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

    log.info(`Shopify push complete (upserted: ${summary.upserted}, variants: ${summary.variantsSynced}, deleted: ${summary.deleted}, failed: ${summary.failed})`);

    await run.finish('success', {
      summary: { upserted: summary.upserted, variantsSynced: summary.variantsSynced, deleted: summary.deleted, failed: summary.failed },
    });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message, stack: err.stack }, 'Shopify push failed');
    await run.finish('failed', { error: err });
    throw error;
  }

  return summary;
}

async function upsertModel(
  entry: ModelWithVariants,
  knownProductId: string | null,
  locationId: string,
  summary: PushSummary,
  shopify: ShopifyClient,
  log: Logger,
): Promise<void> {
  const modelCode = entry.model.model_code;
  const handle = handleForModel(modelCode);

  const existingId = knownProductId ?? (await shopify.findProductIdByHandle(handle));

  const input = buildProductSetInput(entry, existingId);
  const result = await shopify.productSet(input);

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
      log.warn(`Shopify did not return a variant for SKU ${v.product_code} (model ${modelCode})`);
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

  await shopify.setInventoryQuantities(inventoryUpdates);

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
      logger.error({ error: err.message }, 'Scheduled Shopify push failed');
    }
  });
  logger.info(`Shopify push cron scheduled (${config.shopify.pushCron})`);
}

if (require.main === module) {
  runShopifyPush().catch((error) => {
    const err = error as Error;
    logger.error({ error: err.message, stack: err.stack }, 'Shopify production push failed');
    process.exitCode = 1;
  });
}
