/**
 * One-off script: publish every product in store_product_links to the
 * Online Store sales channel.
 *
 * Usage:  npm run shopify:publish-existing
 *
 * Reads SHOPIFY_PUBLICATION_ID from the environment (or .env) and calls
 * publishablePublish for each linked product. Safe to re-run — publishing
 * an already-published product is a no-op on Shopify's side.
 */
import { config } from '../config/env';
import { logger } from '../logger';
import { ShopifyClient } from './shopify-client';
import { configureProductsApi, getAllStoreProductLinks } from '../api/products-api';
import { DatabaseClient } from '../api/db-client';

async function main(): Promise<void> {
  const publicationId = config.shopify.publicationId;
  if (!publicationId) {
    logger.error('SHOPIFY_PUBLICATION_ID is not set — cannot publish products');
    process.exitCode = 1;
    return;
  }

  const shopify = new ShopifyClient(logger);
  const db = new DatabaseClient(logger);
  configureProductsApi(logger, db);

  const links = await getAllStoreProductLinks();
  if (links.length === 0) {
    logger.info('No products in store_product_links — nothing to publish');
    return;
  }

  logger.info(`Publishing ${links.length} existing product(s) to ${publicationId}`);

  let published = 0;
  let failed = 0;

  for (const link of links) {
    try {
      await shopify.publishProduct(link.external_product_id, publicationId);
      published++;
      logger.info(`Published ${link.model_code} (${link.external_product_id})`);
    } catch (error) {
      failed++;
      const err = error as Error;
      logger.error(`Failed to publish ${link.model_code} (${link.external_product_id}): ${err.message}`);
    }
  }

  logger.info(`Done — published: ${published}, failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const err = error as Error;
  logger.error({ error: err.message, stack: err.stack }, 'publish-existing failed');
  process.exitCode = 1;
});
