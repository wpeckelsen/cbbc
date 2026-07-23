import * as cron from 'node-cron';
import { config } from './config/env';
import { logger } from './logger';
import "dotenv/config";
import { FtpClient } from './ftp/ftp-client';
import { parseProductsCsv, parsePricesCsv, parseStockCsv, parseCategoriesCsv, parseCategoryHierarchyCsv, parseImagesCsv } from './parsers/csv-parser';
import { ProductValidator } from './validation/product-validator';
import { isVariantEligible, getEligibilityStats, filterInconsistentVariants } from './filters/product-filter';
import { brandFilter } from './filters/brand-filter';
import { configureProductsApi, insertProductsStaging, insertPricesStaging, insertStockStaging, insertCategories, insertCategoryHierarchy, insertImagesStaging, promoteToProduction, clearProductionProductsForDev, clearStagingTablesForDev } from './api/products-api';
import { logBoundarySample } from './utils/pipeline-debug';
import { RunContext } from './logging';
import { checkDrift } from './db/drift-check';
import { DatabaseClient } from './api/db-client';
import { runShopifyPush } from './shopify/push-production';
import fs from 'fs';
import path from 'path';

function normalizeHyphenKeysInPlace(record: Record<string, any>): void {
  for (const k of Object.keys(record)) {
    if (!k.includes('-')) continue;
    const normalizedKey = k.replace(/-/g, '_');
    if (!(normalizedKey in record)) {
      record[normalizedKey] = record[k];
    }
    delete record[k];
  }
}

function normalizeNonEmptyString(value: any): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t === '' ? undefined : t;
}

function normalizeCategoryCodesFromCsv(value: any): string[] {
  if (typeof value !== 'string') return [];
  const parts = value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map((v) => v.toLowerCase());
  const out = parts.filter((v) => v !== '');
  out.sort((a, b) => a.localeCompare(b));
  return Array.from(new Set(out));
}

async function runPipeline(): Promise<void> {
  const run = new RunContext('pipeline');
  const log = run.log;

  log.info('Starting FTP product pipeline');

  // Wire the run logger into shared modules
  const db = new DatabaseClient(log);
  configureProductsApi(log, db);

  const ftpClient = new FtpClient(log);
  const validator = new ProductValidator();

  let pipelineModels = 0;
  let pipelineVariants = 0;

  try {
    // Pre-run: DB drift check
    await checkDrift(log);

    // Step 1: Connect to FTP
    await ftpClient.connect();

    // Cache directory for FTP downloads
    const cacheDir = path.join(__dirname, '../../cache/ftp');

    // In prod, clear cache each run to ensure fresh supplier data
    if (!config.ftp.useCache && fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      log.info('Cleared FTP cache (prod mode)');
    }
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Step 2: Download files
    const filesToDownload = [
      { remote: '/Data/Products/products.csv', local: path.join(cacheDir, 'products.csv') },
      { remote: '/Retail_pricelist.csv', local: path.join(cacheDir, 'prices.csv') },
      { remote: '/ic_CSV.csv', local: path.join(cacheDir, 'stock_product.csv') },
      { remote: '/Data/product_category_descriptions.csv', local: path.join(cacheDir, 'categories.csv') },
      { remote: '/Data/product_category_hierarchy.csv', local: path.join(cacheDir, 'category_hierarchy.csv') },
      { remote: '/Data/product_images.csv', local: path.join(cacheDir, 'images.csv') },
    ];

    let downloadedCount = 0;
    let cachedCount = 0;
    for (const file of filesToDownload) {
      try {
        const existed = fs.existsSync(file.local);
        await ftpClient.downloadWithCache(file.remote, file.local);
        if (existed) cachedCount++; else downloadedCount++;
      } catch (error) {
        const err = error as Error;
        log.warn(`Failed to download ${file.remote}, skipping (${err.message})`);
      }
    }
    log.info(`Downloaded ${filesToDownload.length} CSV files (${cachedCount} from cache)`);

    // Step 3: Parse files
    let products = fs.existsSync(path.join(cacheDir, 'products.csv')) ? await parseProductsCsv(path.join(cacheDir, 'products.csv'), log) : [];
    for (const p of products) normalizeHyphenKeysInPlace(p);

    // -----------------------------------------------------------------------
    // Step 3.5: Brand pre-filter — runs before all downstream processing so
    // that only products from whitelisted brands enter the pipeline.
    // Controlled by BRAND_FILTER_ENABLED env var and brands.md file contents.
    // Also normalizes vendor_name in-place (underscores → spaces, title-case).
    // -----------------------------------------------------------------------
    products = brandFilter(products, log, config.brandFilterEnabled);
    const prices = fs.existsSync(path.join(cacheDir, 'prices.csv')) ? await parsePricesCsv(path.join(cacheDir, 'prices.csv'), log) : [];
    const stockProduct = fs.existsSync(path.join(cacheDir, 'stock_product.csv')) ? await parseStockCsv(path.join(cacheDir, 'stock_product.csv'), 'product_code', log) : [];
    const categories = fs.existsSync(path.join(cacheDir, 'categories.csv')) ? await parseCategoriesCsv(path.join(cacheDir, 'categories.csv'), log) : [];
    const categoryHierarchy = fs.existsSync(path.join(cacheDir, 'category_hierarchy.csv')) ? await parseCategoryHierarchyCsv(path.join(cacheDir, 'category_hierarchy.csv'), log) : [];
    const images = fs.existsSync(path.join(cacheDir, 'images.csv')) ? await parseImagesCsv(path.join(cacheDir, 'images.csv'), log) : [];

    logBoundarySample('post-parse:products', products as any, undefined, log);
    logBoundarySample('post-parse:prices', prices as any, undefined, log);
    logBoundarySample('post-parse:stock_product', stockProduct as any, undefined, log);
    logBoundarySample('post-parse:categories', categories as any, undefined, log);
    logBoundarySample('post-parse:category_hierarchy', categoryHierarchy as any, undefined, log);
    logBoundarySample('post-parse:images', images as any, undefined, log);

    log.info(`Parsed ${products.length} product rows`);

    // Step 4: Build lookup maps for O(1) access (avoid O(n²) .find() loops)
    const priceMap = new Map(prices.map(p => [p.PRODUCT_CODE, p]));
    const stockMap = new Map(stockProduct.map(s => [s.PRODUCT_CODE, s]));

    // Multi-image: collect ALL images per product_code
    const imageMap = new Map<string, Array<{ IMAGE_URL: string }>>();
    for (const img of images) {
      const code = img.PRODUCT_CODE;
      if (!code) continue;
      const list = imageMap.get(code) ?? [];
      list.push({ IMAGE_URL: img.IMAGE_URL });
      imageMap.set(code, list);
    }

    // Step 5: Build model metadata from parent rows, then validate and enrich
    // all rows that flow through the pipeline (child variants + sellable parents).
    const parentRows: any[] = [];
    const variantRows: any[] = [];
    for (const p of products) {
      const parent = normalizeNonEmptyString(p.parent);
      if (parent) variantRows.push(p);
      else parentRows.push(p);
    }

    log.info(`Split into ${parentRows.length} parent rows + ${variantRows.length} variant rows`);

    // Build model metadata from parent rows (used later for consistency checking
    // and promotion name/brand/category fallback).
    const modelMetadataByCode = new Map<string, any>();
    for (const p of parentRows) {
      const modelCode = normalizeNonEmptyString(p.product_code);
      if (!modelCode) continue;
      if (modelMetadataByCode.has(modelCode)) continue;

      modelMetadataByCode.set(modelCode, {
        product_model_name_en: normalizeNonEmptyString(p.product_model_name_en),
        product_model_name_fi: normalizeNonEmptyString(p.product_model_name_fi),
        product_model_name_sv: normalizeNonEmptyString(p.product_model_name_sv),
        name_en: normalizeNonEmptyString(p.product_name_en),
        name_fi: normalizeNonEmptyString(p.product_name_fi),
        name_sv: normalizeNonEmptyString(p.product_name_sv),
        brand: normalizeNonEmptyString(p.brand),
        vendor_name: normalizeNonEmptyString(p.vendor_name),
        category_codes: normalizeCategoryCodesFromCsv(p.categories),
        catalog_restriction: normalizeNonEmptyString(p.catalog_restriction),
        short_description_en: normalizeNonEmptyString(p.short_description_en),
      });
    }

    // Select which parent rows act as variants in their own right.
    // A parent row is "sellable" when it meets the same eligibility checks
    // that will be applied post-enrichment by isVariantEligible. We pre-screen
    // here to avoid enriching rows that would be discarded anyway.
    const isSellableParentRow = (p: any): boolean => {
      const productCode = normalizeNonEmptyString(p.product_code);
      if (!productCode) return false;

      // Quick pre-checks on raw CSV fields before enrichment.
      const hasName = Boolean(normalizeNonEmptyString(p.product_name_en));
      const hasBrand = Boolean(normalizeNonEmptyString(p.brand));
      const hasVendor = Boolean(normalizeNonEmptyString(p.vendor_name));
      const hasCategories = normalizeCategoryCodesFromCsv(p.categories).length > 0;
      const barcode = normalizeNonEmptyString(p.barcode);
      const hasBarcode = typeof barcode === 'string' && /^\d+$/.test(barcode);

      const price = priceMap.get(productCode);
      const stock = stockMap.get(productCode);
      const productImages = imageMap.get(productCode);

      return Boolean(hasName && hasBrand && hasVendor && hasCategories && hasBarcode && price && stock && productImages && productImages.length > 0);
    };

    const sellableParentRows = parentRows.filter(isSellableParentRow);
    const rowsToEnrich = [...variantRows, ...sellableParentRows];

    if (sellableParentRows.length > 0) {
      log.info(`Included ${sellableParentRows.length} sellable parent rows as variants`);
    }

    const validatedProducts = rowsToEnrich.map((product) => {
      const price = priceMap.get(product.product_code);
      const stock = stockMap.get(product.product_code);
      const productImages = imageMap.get(product.product_code);
      return validator.enrichProduct(product, price, stock, productImages);
    });
    log.info(`Enriched ${validatedProducts.length} variants`);

    logBoundarySample('post-validate:validated_products', validatedProducts as any, undefined, log);

    // -----------------------------------------------------------------------
    // Step 6: Model consistency filter (formerly "gate 3").
    // Rejects variant children whose brand/vendor/category don't match the
    // parent model's established truth, preventing corrupt multi-variant
    // products in Shopify.
    // -----------------------------------------------------------------------
    const consistency = filterInconsistentVariants(validatedProducts, modelMetadataByCode);
    if (consistency.dropped > 0) {
      log.warn(`Dropped ${consistency.dropped} variants conflicting with model truth (${consistency.droppedModelCodes.size} models affected)`);
    }
    const consistentValidatedVariants = consistency.kept;

    // -----------------------------------------------------------------------
    // Step 7: Unified variant eligibility filter (consolidated gates 1 + 2 + 4).
    // A single check that replaces:
    //   - isSellableParentRow (gate 1) — already used as a pre-screen above,
    //     but the enriched variants are re-checked here for consistency.
    //   - customLogic in ProductFilter (gate 2)
    //   - Dead guard in promoteToProduction (gate 4, now removed)
    // -----------------------------------------------------------------------
    const eligibilityStats = getEligibilityStats(consistentValidatedVariants);
    const qualifyingVariants = consistentValidatedVariants.filter(
      (v) => isVariantEligible(v).eligible,
    );
    log.info(
      `Eligibility: ${qualifyingVariants.length} / ${consistentValidatedVariants.length} variants passed (${eligibilityStats.passRate.toFixed(1)}%)`,
    );
    log.info('Rejection reasons', { reasons: eligibilityStats.rejectionReasons });

    // -----------------------------------------------------------------------
    // Step 8: Eligible models are those with >= 1 qualifying variant.
    // Then cap by model count if PIPELINE_MODEL_LIMIT is set.
    // -----------------------------------------------------------------------
    const eligibleModelSet = new Set<string>();
    for (const v of qualifyingVariants) {
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      eligibleModelSet.add(modelCode);
    }

    const validVariantCountByModel = new Map<string, number>();
    for (const v of consistentValidatedVariants) {
      if (!Array.isArray(v.errors) || v.errors.length !== 0) continue;
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      validVariantCountByModel.set(modelCode, (validVariantCountByModel.get(modelCode) ?? 0) + 1);
    }

    const eligibleModelOrder = Array.from(eligibleModelSet).sort((a, b) => {
      const da = validVariantCountByModel.get(a) ?? 0;
      const db = validVariantCountByModel.get(b) ?? 0;
      if (db !== da) return db - da;
      return a.localeCompare(b);
    });

    const variantsToPromote = consistentValidatedVariants.filter((v) => {
      if (!Array.isArray(v.errors) || v.errors.length !== 0) return false;
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      return eligibleModelSet.has(modelCode);
    });

    const modelLimit = config.pipelineModelLimit;
    const cappedModelCodes = modelLimit > 0
      ? eligibleModelOrder.slice(0, modelLimit)
      : eligibleModelOrder;
    const cappedModelCodeSet = new Set<string>(cappedModelCodes);
    const cappedVariantsToPromote = variantsToPromote.filter((v) => {
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      return cappedModelCodeSet.has(modelCode);
    });

    pipelineModels = cappedModelCodes.length;
    pipelineVariants = cappedVariantsToPromote.length;
    if (modelLimit > 0) {
      log.info(`Applied model cap: ${pipelineModels} models, ${pipelineVariants} variants (limit: ${modelLimit})`);
    } else {
      log.info(`No model cap (prod): ${pipelineModels} models, ${pipelineVariants} variants`);
    }

    // Step 9: Filter related data to match only the selected variant SKUs
    const cappedProductCodes = new Set(cappedVariantsToPromote.map((v) => v.product_code));
    const cappedRawProducts = products.filter((p) => cappedProductCodes.has(p.product_code));
    const cappedPrices = prices.filter((p) => cappedProductCodes.has(p.PRODUCT_CODE));
    const cappedStockProduct = stockProduct.filter((s) => typeof s.PRODUCT_CODE === 'string' && cappedProductCodes.has(s.PRODUCT_CODE));
    const cappedImages = images.filter((i) => cappedProductCodes.has(i.PRODUCT_CODE));

    // Step 10: Insert ONLY filtered data to staging
    if (config.dev.cleanSlate) {
      await clearStagingTablesForDev();
    }
    if (cappedRawProducts.length > 0) await insertProductsStaging(cappedRawProducts);
    if (cappedPrices.length > 0) await insertPricesStaging(cappedPrices);
    if (cappedStockProduct.length > 0) await insertStockStaging(cappedStockProduct, 'product_code');
    if (categories.length > 0) await insertCategories(categories);
    if (categoryHierarchy.length > 0) await insertCategoryHierarchy(categoryHierarchy);
    if (cappedImages.length > 0) await insertImagesStaging(cappedImages);

    // Step 11: Promote filtered variants to normalized production tables
    const cappedModelMetadataByCode = new Map<string, any>();
    for (const modelCode of cappedModelCodes) {
      const meta = modelMetadataByCode.get(modelCode);
      if (meta) cappedModelMetadataByCode.set(modelCode, meta);
    }

    await promoteToProduction(cappedVariantsToPromote, {
      modelMetadataByCode: cappedModelMetadataByCode,
    });

    if (config.dev.cleanSlate) {
      await clearProductionProductsForDev();
      await clearStagingTablesForDev();
    }

    logBoundarySample('pre-store-sync:products', cappedVariantsToPromote as any, { maxStringLen: 80 }, log);

    log.info('Pipeline completed successfully');

    await run.finish('success', {
      summary: { models: pipelineModels, variants: pipelineVariants },
    });
    // In dev mode, automatically run Shopify push after pipeline completes
    if (!config.isProd) {
      log.info('Dev mode: starting Shopify push after pipeline');
      await runShopifyPush();
    }
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message, stack: err.stack }, 'Pipeline failed');
    await run.finish('failed', { error: err });
    throw error;
  } finally {
    await ftpClient.disconnect();
  }
}

// Schedule cron jobs only in prod — dev runs immediately on boot instead.
if (config.nodeEnv !== 'test' && config.isProd) {
  cron.schedule(config.cron.schedule, async () => {
    try {
      await runPipeline();
    } catch (error) {
      const err = error as Error;
      logger.error('Scheduled job failed', { error: err.message });
    }
  });
  logger.info('Pipeline cron scheduled', { schedule: config.cron.schedule });

  if (config.shopify.pushCron) {
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
}

// Run immediately on boot in dev (unless RUN_ON_STARTUP=false), or in prod
// only when explicitly requested via RUN_ON_STARTUP=true.
if (require.main === module && process.env.RUN_ON_STARTUP !== 'false' && (!config.isProd || process.env.RUN_ON_STARTUP === 'true')) {
  runPipeline().catch(console.error);
}