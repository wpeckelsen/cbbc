import * as cron from 'node-cron';
import { Logger } from 'pino';
import { config } from '../config/env';
import { logger } from '../logger';
import {
  configureProductsApi,
  getPromotedModelsWithVariants,
  getAllStoreProductLinks,
  getAllStoreVariantLinks,
  upsertStoreProductLink,
  upsertStoreVariantLink,
  deleteStoreProductLink,
  updateModelSyncStatus,
  logStoreSync,
  ModelWithVariants,
  StoreProductLink,
} from '../api/products-api';
import { ShopifyClient, shopifyClient as defaultShopifyClient, InventoryQuantity } from './shopify-client';
import { DatabaseClient } from '../api/db-client';
import { buildProductSetInput, handleForModel } from './mappers';
import { RunContext } from '../logging';
import { checkDrift } from '../db/drift-check';
import { computeContentHashes, ContentHashes } from './content-hash';

type PushSummary = {
  upserted: number;
  inventoryOnly: number;
  skipped: number;
  variantsSynced: number;
  deleted: number;
  failed: number;
  repaired: number;
  backlogPublished: number;
};

/**
 * Push the promoted catalogue to Shopify.
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
  if (!config.shopify.storeDomain) {
    throw new Error('Shopify is not configured (set SHOPIFY_STORE_DOMAIN)');
  }
  if (!config.shopify.adminAccessToken) {
    if (config.shopify.clientId && config.shopify.secret) {
      throw new Error(
        'SHOPIFY_ADMIN_ACCESS_TOKEN is not set. Run `npm run shopify:auth` to authorize via OAuth.',
      );
    }
    throw new Error('Shopify is not configured (set SHOPIFY_ADMIN_ACCESS_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_SECRET and run `npm run shopify:auth`)');
  }

  const run = new RunContext('shopify-push');
  const log: Logger = run.log;

  // Wire modules to the run logger
  const shopify = new ShopifyClient(log);
  const db = new DatabaseClient(log);
  configureProductsApi(log, db);

  const forcePush = config.shopify.forcePush;
  if (forcePush) log.warn('SHOPIFY_FORCE_PUSH is enabled — all models will be pushed regardless of content hash');

  const summary: PushSummary = { upserted: 0, inventoryOnly: 0, skipped: 0, variantsSynced: 0, deleted: 0, failed: 0, repaired: 0, backlogPublished: 0 };

  try {
    // Pre-run: DB drift check
    await checkDrift(log);

    const locationId = await shopify.getLocationId();
    log.info(`Resolved Shopify inventory location (${locationId})`);

    const publicationId = config.shopify.publicationId;
    if (publicationId) {
      log.info(`Will publish products to sales channel (${publicationId})`);
    } else {
      log.warn('SHOPIFY_PUBLICATION_ID not set — products will not be published to any sales channel');
    }

    const [entries, existingLinks] = await Promise.all([
      getPromotedModelsWithVariants(),
      getAllStoreProductLinks(),
    ]);

    const pushLimit = config.shopify.pushModelLimit;
    const cappedEntries = pushLimit > 0 ? entries.slice(0, pushLimit) : entries;
    if (pushLimit > 0 && entries.length > pushLimit) {
      log.warn(`Promoted catalogue has ${entries.length} models — capping Shopify push to ${pushLimit}`);
    }

    const linkByModel = new Map(existingLinks.map((l) => [l.model_code, l]));
    // Deletion uses ALL promoted models (not capped) — a model beyond the cap
    // should not be deleted just because it's past the limit.
    const currentModelCodes = new Set(entries.map((e) => e.model.model_code));

    // --- Ghost detection: find products deleted directly in Shopify ---
    const linkedProductIds = existingLinks.map((l) => l.external_product_id);
    const aliveIds = await shopify.checkProductsExist(linkedProductIds);
    for (const link of existingLinks) {
      if (aliveIds.has(link.external_product_id)) continue;
      log.warn(`Ghost detected: ${link.model_code} (${link.external_product_id}) no longer exists in Shopify — clearing link for re-push`);
      await deleteStoreProductLink(link.model_code);
      linkByModel.delete(link.model_code);
      summary.repaired++;
      await logStoreSync({
        scope: 'product',
        local_code: link.model_code,
        external_id: link.external_product_id,
        action: 'delete',
        status: 'success',
        message: 'ghost-repair (externally deleted)',
      });
    }
    if (summary.repaired > 0) {
      log.info(`Cleared ${summary.repaired} ghost link(s) — affected models will be re-created`);
    }

    log.info(`Starting Shopify push (${cappedEntries.length} models, ${existingLinks.length} existing links)`);

    // --- Upserts (with content-hash skip-if-unchanged) ---
    for (const entry of cappedEntries) {
      const modelCode = entry.model.model_code;
      const link = linkByModel.get(modelCode);
      const hashes = computeContentHashes(entry);

      try {
        if (!forcePush && link) {
          const productUnchanged = link.last_pushed_product_hash === hashes.productHash;
          const stockUnchanged = link.last_pushed_stock_hash === hashes.stockHash;

          if (productUnchanged && stockUnchanged) {
            log.debug(`Skipping ${modelCode} (product+stock unchanged)`);
            summary.skipped++;
            continue;
          }

          if (productUnchanged && !stockUnchanged) {
            await syncInventoryOnly(entry, link, locationId, hashes, summary, shopify, log);
            continue;
          }
        }

        await upsertModel(entry, link?.external_product_id ?? null, locationId, publicationId, hashes, summary, shopify, log);
      } catch (error) {
        summary.failed++;
        const err = error as Error;
        log.error(`Failed to sync model ${modelCode} to Shopify (${err.message})`);
        await logStoreSync({
          scope: 'product',
          local_code: modelCode,
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

    // --- One-shot backlog publish (SHOPIFY_PUBLISH_BACKLOG=true) ---
    // Assigns the sales channel to products that never went through an upsert
    // this run (skipped/inventory-only), e.g. the pre-existing catalogue.
    if (config.shopify.publishBacklog) {
      if (!publicationId) {
        log.warn('SHOPIFY_PUBLISH_BACKLOG is set but SHOPIFY_PUBLICATION_ID is not — skipping backlog publish');
      } else {
        await publishBacklog(publicationId, summary, shopify, log);
      }
    }

    log.info(
      `Shopify push complete (upserted: ${summary.upserted}, inventory-only: ${summary.inventoryOnly}, skipped: ${summary.skipped}, variants: ${summary.variantsSynced}, deleted: ${summary.deleted}, repaired: ${summary.repaired}, backlog-published: ${summary.backlogPublished}, failed: ${summary.failed})`,
    );

    await run.finish('success', {
      summary: {
        upserted: summary.upserted,
        inventoryOnly: summary.inventoryOnly,
        skipped: summary.skipped,
        variantsSynced: summary.variantsSynced,
        deleted: summary.deleted,
        repaired: summary.repaired,
        backlogPublished: summary.backlogPublished,
        failed: summary.failed,
      },
    });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message, stack: err.stack }, 'Shopify push failed');
    await run.finish('failed', { error: err });
    throw error;
  }

  return summary;
}

/**
 * Inventory-only fast path: when only stock levels changed (product hash
 * matches), skip the expensive productSet mutation and only write inventory.
 */
async function syncInventoryOnly(
  entry: ModelWithVariants,
  link: StoreProductLink,
  locationId: string,
  hashes: ContentHashes,
  summary: PushSummary,
  shopify: ShopifyClient,
  log: Logger,
): Promise<void> {
  const modelCode = entry.model.model_code;
  log.info(`Inventory-only update for ${modelCode} (product unchanged, stock changed)`);

  // Re-use the existing store_variant_links to map product_codes -> inventoryItemIds
  // rather than calling Shopify.
  const variantLinks = await getAllStoreVariantLinks(modelCode);
  const inventoryItemByCode = new Map(
    variantLinks
      .filter((vl) => vl.external_inventory_item_id)
      .map((vl) => [vl.product_code, vl.external_inventory_item_id!]),
  );

  const inventoryUpdates: InventoryQuantity[] = [];
  for (const v of entry.variants) {
    const inventoryItemId = inventoryItemByCode.get(v.product_code);
    if (!inventoryItemId) {
      log.warn(`No inventory item id for SKU ${v.product_code} (model ${modelCode}) — falling back to full upsert`);
      await upsertModel(entry, link.external_product_id, locationId, config.shopify.publicationId, hashes, summary, shopify, log);
      return;
    }
    inventoryUpdates.push({
      inventoryItemId,
      locationId,
      quantity: Math.max(0, Math.trunc(v.stock_total)),
    });
  }

  await shopify.setInventoryQuantities(inventoryUpdates);

  // Update only the stock hash; product hash stays the same.
  await upsertStoreProductLink({
    model_code: modelCode,
    external_product_id: link.external_product_id,
    external_handle: link.external_handle,
    last_pushed_product_hash: hashes.productHash,
    last_pushed_stock_hash: hashes.stockHash,
  });

  await updateModelSyncStatus(modelCode, new Date());
  summary.inventoryOnly++;
  summary.variantsSynced += entry.variants.length;

  await logStoreSync({
    scope: 'product',
    local_code: modelCode,
    external_id: link.external_product_id,
    action: 'update',
    status: 'success',
    message: 'inventory-only',
  });
}

/**
 * Publish every currently-linked product to the sales channel. Used as a
 * one-shot backfill (gated by SHOPIFY_PUBLISH_BACKLOG) so the existing
 * catalogue gets the Online Store channel assigned on a scheduled run without
 * a manual/local invocation. Publishing an already-published product is a
 * no-op on Shopify's side, so this is safe to leave on (just wasteful).
 */
async function publishBacklog(
  publicationId: string,
  summary: PushSummary,
  shopify: ShopifyClient,
  log: Logger,
): Promise<void> {
  const links = await getAllStoreProductLinks();
  log.info(`Backlog publish: ensuring ${links.length} linked product(s) are on the sales channel (${publicationId})`);

  for (const link of links) {
    try {
      await shopify.publishProduct(link.external_product_id, publicationId);
      summary.backlogPublished++;
    } catch (error) {
      summary.failed++;
      const err = error as Error;
      log.error(`Backlog publish failed for ${link.model_code} (${link.external_product_id}): ${err.message}`);
      await logStoreSync({
        scope: 'product',
        local_code: link.model_code,
        external_id: link.external_product_id,
        action: 'update',
        status: 'failed',
        message: `backlog-publish: ${err.message}`,
      });
    }
  }

  log.info(`Backlog publish complete (${summary.backlogPublished} published, ${summary.failed} failed)`);
}

async function upsertModel(
  entry: ModelWithVariants,
  knownProductId: string | null,
  locationId: string,
  publicationId: string,
  hashes: ContentHashes,
  summary: PushSummary,
  shopify: ShopifyClient,
  log: Logger,
): Promise<void> {
  const modelCode = entry.model.model_code;
  const handle = handleForModel(modelCode);

  let existingId = knownProductId ?? (await shopify.findProductIdByHandle(handle));

  let input = buildProductSetInput(entry, existingId);

  // Diagnostic: log whether descriptionHtml is present in the Shopify input
  const descHtml = input.descriptionHtml as string | undefined;
  if (descHtml && descHtml.trim() !== '') {
    log.info({ modelCode, descPreview: descHtml.substring(0, 80) }, 'push: sending descriptionHtml to Shopify');
  } else {
    log.info({ modelCode, hasDescriptionHtml: 'descriptionHtml' in input, descValue: input.descriptionHtml }, 'push: NO descriptionHtml being sent to Shopify');
  }

  let result: Awaited<ReturnType<ShopifyClient['productSet']>>;

  try {
    result = await shopify.productSet(input);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (existingId && msg.includes('Product does not exist')) {
      log.warn(`Stale product link for ${modelCode} (${existingId}) — retrying as create`);
      existingId = null;
      input = buildProductSetInput(entry, null);
      result = await shopify.productSet(input);
    } else {
      throw err;
    }
  }

  await upsertStoreProductLink({
    model_code: modelCode,
    external_product_id: result.productId,
    external_handle: result.handle,
    last_pushed_product_hash: hashes.productHash,
    last_pushed_stock_hash: hashes.stockHash,
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

  if (publicationId) {
    await shopify.publishProduct(result.productId, publicationId);
  }

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

// When run directly (npm run shopify:push:prod), register its own cron and
// run immediately.  When imported by worker.ts, skip — the worker handles
// cron registration and invocation to avoid double-scheduling.
if (require.main === module) {
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

  runShopifyPush().catch((error) => {
    const err = error as Error;
    logger.error({ error: err.message, stack: err.stack }, 'Shopify production push failed');
    process.exitCode = 1;
  });
}
