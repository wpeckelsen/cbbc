import { getNewestProductsFromProduction, logEcwidSync, updateProductSyncStatus } from '../api/products-api';
import { ecwidClient } from './ecwid-client';
import { logger } from '../logger';

type ProductionProductRow = {
  product_code: string;
  name_en: string;
  price_eur_incl_vat: number;
};

async function run(): Promise<void> {
  const limit = 10;

  const products = (await getNewestProductsFromProduction(limit)) as ProductionProductRow[];
  logger.info('Loaded products from production for Ecwid push', { count: products.length, limit });

  if (products.length === 0) {
    logger.info('No products found in production table; nothing to push to Ecwid');
    return;
  }

  const batchItems = products.map((p) => ({
    productCode: p.product_code,
    name: p.name_en,
    price: p.price_eur_incl_vat,
    sku: p.product_code,
  }));

  const results = await ecwidClient.batchCreateProducts(batchItems);

  let created = 0;
  let failed = 0;

  for (const r of results) {
    if (r.status === 'success') {
      created++;
      await updateProductSyncStatus(r.productCode, new Date());
    } else {
      failed++;
    }

    await logEcwidSync(r.productCode, r.ecwidItemId ?? null, r.status, r.message);
  }

  logger.info('Ecwid batch push complete', { attempted: results.length, created, failed });
}

if (require.main === module) {
  run().catch((error) => {
    const err = error as Error;
    logger.error('Ecwid production push failed', { error: err.message, stack: err.stack });
    process.exitCode = 1;
  });
}
