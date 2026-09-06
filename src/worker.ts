import { config } from './config/env';
import { logger } from './logger';
import "dotenv/config";
import { FtpClient } from './ftp/ftp-client';
import { parseProductsCsv, parsePricesCsv, parseStockCsv, parseCategoriesCsv, parseCategoryHierarchyCsv, parseImagesCsv } from './parsers/csv-parser';
import { ProductValidator } from './validation/product-validator';
import { isVariantEligible, getEligibilityStats, filterInconsistentVariants } from './filters/product-filter';
import { brandFilter } from './filters/brand-filter';
import { configureProductsApi, insertProductsStaging, insertPricesStaging, insertStockStaging, insertCategories, insertCategoryHierarchy, insertImagesStaging, promoteToProduction, cleanupStaleProductionRecords, insertProductPipelineStatus, pruneProductPipelineStatus } from './api/products-api';
import { logBoundarySample } from './utils/pipeline-debug';
import { RunContext } from './logging';
import { checkDrift } from './db/drift-check';
import { DatabaseClient, getDatabasePool } from './api/db-client';
import { runShopifyPush } from './shopify/push-production';
import { TraceRecorder } from './tracing/pipeline-trace';
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
  const tracer = new TraceRecorder(run.runId);

  let pipelineModels = 0;
  let pipelineVariants = 0;

  try {
    // Pre-run: DB drift check
    await checkDrift(log);

    // Step 1: Connect to FTP
    await ftpClient.connect();

    // Cache directory for FTP downloads
    const cacheDir = path.join(process.cwd(), 'cache/ftp');

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
    const brandResult = brandFilter(products, log, config.brandFilterEnabled);
    for (const p of brandResult.dropped) {
      tracer.reject(
        {
          product_code: p.product_code,
          model_code: normalizeNonEmptyString(p.parent),
          barcode: normalizeNonEmptyString(p.barcode),
          vendor_name: normalizeNonEmptyString(p.vendor_name),
          name_en: normalizeNonEmptyString(p.product_name_en),
        },
        'brand_filter',
        'brand_not_whitelisted',
      );
    }
    products = brandResult.kept;
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
    const sellableParentCheck = (p: any): { eligible: boolean; reason?: string } => {
      const productCode = normalizeNonEmptyString(p.product_code);
      if (!productCode) return { eligible: false, reason: 'no_product_code' };
      if (!normalizeNonEmptyString(p.product_name_en)) return { eligible: false, reason: 'no_name' };
      if (!(normalizeNonEmptyString(p.vendor_name) || normalizeNonEmptyString(p.brand))) return { eligible: false, reason: 'no_brand' };
      if (!normalizeNonEmptyString(p.vendor_name)) return { eligible: false, reason: 'no_vendor' };
      if (normalizeCategoryCodesFromCsv(p.categories).length === 0) return { eligible: false, reason: 'no_categories' };
      const barcode = normalizeNonEmptyString(p.barcode);
      if (typeof barcode !== 'string' || !/^\d+$/.test(barcode)) return { eligible: false, reason: 'invalid_barcode' };
      if (!priceMap.get(productCode)) return { eligible: false, reason: 'no_price' };
      if (!stockMap.get(productCode)) return { eligible: false, reason: 'no_stock' };
      const productImages = imageMap.get(productCode);
      if (!productImages || productImages.length === 0) return { eligible: false, reason: 'no_image' };
      return { eligible: true };
    };

    const sellableParentRows: any[] = [];
    for (const p of parentRows) {
      const check = sellableParentCheck(p);
      if (check.eligible) {
        sellableParentRows.push(p);
      } else {
        tracer.reject(
          {
            product_code: p.product_code,
            model_code: normalizeNonEmptyString(p.product_code),
            barcode: normalizeNonEmptyString(p.barcode),
            vendor_name: normalizeNonEmptyString(p.vendor_name),
            name_en: normalizeNonEmptyString(p.product_name_en),
          },
          'parent_pre_screen',
          check.reason ?? 'parent_not_sellable',
        );
      }
    }
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
    for (const v of consistency.droppedVariants) {
      tracer.reject(
        {
          product_code: v.product_code,
          model_code: typeof v.model_code === 'string' ? v.model_code : undefined,
          barcode: v.barcode,
          vendor_name: v.vendor_name,
          name_en: v.name_en,
        },
        'consistency',
        'inconsistent_variant',
      );
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
    const qualifyingVariants: any[] = [];
    for (const v of consistentValidatedVariants) {
      const eligibility = isVariantEligible(v);
      if (eligibility.eligible) {
        qualifyingVariants.push(v);
      } else {
        tracer.reject(
          {
            product_code: v.product_code,
            model_code: typeof v.model_code === 'string' ? v.model_code : undefined,
            barcode: v.barcode,
            vendor_name: v.vendor_name,
            name_en: v.name_en,
          },
          'eligibility',
          eligibility.reason ?? 'unknown',
          Array.isArray(v.errors) && v.errors.length > 0 ? { validation_errors: v.errors } : undefined,
        );
      }
    }
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

    const qualifyingVariantCountByModel = new Map<string, number>();
    for (const v of qualifyingVariants) {
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      qualifyingVariantCountByModel.set(modelCode, (qualifyingVariantCountByModel.get(modelCode) ?? 0) + 1);
    }

    const eligibleModelOrder = Array.from(eligibleModelSet).sort((a, b) => {
      const da = qualifyingVariantCountByModel.get(a) ?? 0;
      const db = qualifyingVariantCountByModel.get(b) ?? 0;
      if (db !== da) return db - da;
      return a.localeCompare(b);
    });

    const variantsToPromote = qualifyingVariants;

    const modelLimit = config.pipelineModelLimit;
    const cappedModelCodes = modelLimit > 0
      ? eligibleModelOrder.slice(0, modelLimit)
      : eligibleModelOrder;
    const cappedModelCodeSet = new Set<string>(cappedModelCodes);
    const cappedVariantsToPromote = variantsToPromote.filter((v) => {
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      return cappedModelCodeSet.has(modelCode);
    });

    if (modelLimit > 0) {
      for (const v of variantsToPromote) {
        const mc = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
        if (!cappedModelCodeSet.has(mc)) {
          tracer.reject(
            {
              product_code: v.product_code,
              model_code: typeof v.model_code === 'string' ? v.model_code : undefined,
              barcode: v.barcode,
              vendor_name: v.vendor_name,
              name_en: v.name_en,
            },
            'model_cap',
            'model_cap',
          );
        }
      }
    }

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

    for (const v of cappedVariantsToPromote) {
      tracer.promote({
        product_code: v.product_code,
        model_code: typeof v.model_code === 'string' ? v.model_code : undefined,
        barcode: v.barcode,
        vendor_name: v.vendor_name,
        name_en: v.name_en,
      });
    }

    // Step 12: Garbage-collect stale production records.
    // Only runs in unlimited mode (prod) — when model cap is active (dev),
    // we must not delete models that were simply beyond the cap.
    if (config.pipelineModelLimit === 0) {
      const stale = await cleanupStaleProductionRecords(
        cappedModelCodes,
        cappedVariantsToPromote.map((v) => v.product_code),
      );
      for (const d of stale.deletedVariants) {
        tracer.reject(
          { product_code: d.product_code, model_code: d.model_code, barcode: d.barcode, name_en: d.name_en },
          'stale_cleanup',
          'removed_stale',
        );
      }
      for (const d of stale.deletedModels) {
        tracer.reject(
          { product_code: d.model_code, model_code: d.model_code, vendor_name: d.vendor_name, name_en: d.name_en },
          'stale_cleanup',
          'removed_stale',
        );
      }
    }

    // Persist the per-product trace. Never let trace failures break the run.
    try {
      await insertProductPipelineStatus(tracer.toRows());
      await pruneProductPipelineStatus(8);
    } catch (traceError) {
      log.warn(`Failed to persist product pipeline traces (${(traceError as Error).message})`);
    }

    logBoundarySample('pre-store-sync:products', cappedVariantsToPromote as any, { maxStringLen: 80 }, log);

    log.info('Pipeline completed successfully');

    await run.finish('success', {
      summary: { models: pipelineModels, variants: pipelineVariants },
    });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message, stack: err.stack }, 'Pipeline failed');
    await run.finish('failed', { error: err });
    throw error;
  } finally {
    await ftpClient.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: run the full CBBC flow once, then exit. The FTP pipeline must
// complete (and commit its data) before the Shopify push starts, so the push
// reads the freshly-promoted catalogue.
// ---------------------------------------------------------------------------
async function runAll(): Promise<void> {
  logger.info('=== CBBC run: starting FTP pipeline ===');
  await runPipeline();
  logger.info('Pipeline done — production data updated. Starting Shopify push.');
  await runShopifyPush();
  logger.info('=== CBBC run: complete ===');
}

// Run-once entrypoint. Railway's Cron Job runs `node dist/worker.js` and
// expects the process to exit cleanly when the work is done, so we close the
// shared pg pool before exiting.
if (require.main === module) {
  runAll()
    .then(async () => {
      await getDatabasePool().end();
    })
    .catch(async (error) => {
      const err = error as Error;
      logger.error({ error: err.message, stack: err.stack }, 'CBBC run failed');
      process.exitCode = 1;
      await getDatabasePool().end();
    });
}