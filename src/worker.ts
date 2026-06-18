import * as cron from 'node-cron';
import { config } from './config/env';
import { logger } from './logger';
import "dotenv/config";
import { FtpClient } from './ftp/ftp-client';
import { parseProductsCsv, parsePricesCsv, parseStockCsv, parseCategoriesCsv, parseCategoryHierarchyCsv, parseImagesCsv } from './parsers/csv-parser';
import { ProductValidator } from './validation/product-validator';
import { ProductFilter } from './filters/product-filter';
import { configureProductsApi, insertProductsStaging, insertPricesStaging, insertStockStaging, insertCategories, insertCategoryHierarchy, insertImagesStaging, promoteToProduction, clearProductionProductsForDev, clearStagingTablesForDev } from './api/products-api';
import { logBoundarySample } from './utils/pipeline-debug';
import { RunContext } from './logging';
import { checkDrift } from './db/drift-check';
import { DatabaseClient } from './api/db-client';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Batch size: number of product rows processed and inserted per flush.
// Keeping this at 1000 bounds peak memory to ~1000 enriched rows at a time.
// ---------------------------------------------------------------------------
const PRODUCT_BATCH_SIZE = 1000;

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

function normalizeCategoryCodes(value: any): string[] {
  if (!Array.isArray(value)) return [];
  const out = value
    .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
    .filter((v) => v !== '');
  out.sort((a, b) => a.localeCompare(b));
  return Array.from(new Set(out));
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
  return normalizeCategoryCodes(parts);
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
  const productFilter = new ProductFilter({
    requiresPrice: true,
    requiresStock: true,
    customLogic: (p: any) => {
      const stockTotal = p.stock_total || 0;
      const hasImage = typeof p.image_url === 'string' && p.image_url.trim() !== '';
      const hasCategories = Array.isArray(p.category_codes) && p.category_codes.length > 0;
      const hasBrand = typeof p.brand === 'string' && p.brand.trim() !== '';
      const hasNoValidationErrors = Array.isArray(p.errors) && p.errors.length === 0;
      return stockTotal > 1 && hasImage && hasCategories && hasBrand && hasNoValidationErrors;
    },
  }, log);

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

    // -----------------------------------------------------------------------
    // Step 3: Load lookup tables fully into memory.
    //
    // Prices, stock, and images are keyed by product_code and are accessed
    // O(1) during product streaming. Categories and hierarchy are small
    // reference tables inserted to the DB before the main product pass.
    //
    // The products CSV — potentially millions of rows — is NOT loaded here;
    // it is streamed in two lightweight passes below.
    // -----------------------------------------------------------------------
    const productsPath = path.join(cacheDir, 'products.csv');
    const pricesPath   = path.join(cacheDir, 'prices.csv');
    const stockPath    = path.join(cacheDir, 'stock_product.csv');
    const catPath      = path.join(cacheDir, 'categories.csv');
    const hierPath     = path.join(cacheDir, 'category_hierarchy.csv');
    const imagesPath   = path.join(cacheDir, 'images.csv');

    const priceMap = fs.existsSync(pricesPath)
      ? await parsePricesCsv(pricesPath, log)
      : new Map();
    const stockMap = fs.existsSync(stockPath)
      ? await parseStockCsv(stockPath, 'product_code', log)
      : new Map();
    const imageMap = fs.existsSync(imagesPath)
      ? await parseImagesCsv(imagesPath, log)
      : new Map();

    const categories      = fs.existsSync(catPath)   ? await parseCategoriesCsv(catPath, log)            : [];
    const categoryHierarchy = fs.existsSync(hierPath) ? await parseCategoryHierarchyCsv(hierPath, log)   : [];

    logBoundarySample('post-parse:categories',         categories as any,        undefined, log);
    logBoundarySample('post-parse:category_hierarchy', categoryHierarchy as any, undefined, log);

    // Insert reference tables to DB immediately — they are small and needed
    // by the DB before variants are promoted.
    if (config.dev.cleanSlate) {
      await clearStagingTablesForDev();
    }
    if (categories.length > 0)        await insertCategories(categories);
    if (categoryHierarchy.length > 0) await insertCategoryHierarchy(categoryHierarchy);

    // -----------------------------------------------------------------------
    // Step 4 (Pass 1): Stream products once to build modelMetadataByCode.
    //
    // Only parent rows (parent field empty) contribute model metadata.
    // This pass is memory-cheap: we store only a small metadata object per
    // unique model code, not the full raw row.
    // -----------------------------------------------------------------------
    const modelMetadataByCode = new Map<string, any>();

    if (fs.existsSync(productsPath)) {
      await parseProductsCsv(productsPath, async (p) => {
        normalizeHyphenKeysInPlace(p);
        const parent = normalizeNonEmptyString(p.parent);
        if (parent) return; // variant row — skip in this pass

        const modelCode = normalizeNonEmptyString(p.product_code);
        if (!modelCode || modelMetadataByCode.has(modelCode)) return;

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
        });
      }, log);
    }

    log.info(`Built model metadata for ${modelMetadataByCode.size} parent rows`);

    // -----------------------------------------------------------------------
    // Step 5 (Pass 2): Stream products again, enrich + validate + filter each
    // row, and flush to the DB in batches of PRODUCT_BATCH_SIZE.
    //
    // Accumulators that must span the full file (model truth, eligible model
    // set, variant counts) are kept as lightweight Maps/Sets of strings/numbers
    // rather than full row objects.
    // -----------------------------------------------------------------------

    // Helpers for model-consistency check (same logic as before, inline)
    type ModelTruth = { brand: string; vendor: string; categoryKey: string };
    const toTruthKey = (codes: any): string => {
      const normalized = normalizeCategoryCodes(codes).map((c) => c.toLowerCase());
      return normalized.join('|');
    };
    const truthFromMeta = (meta: any): ModelTruth | null => {
      const brand       = normalizeNonEmptyString(meta?.brand)?.toLowerCase()       ?? '';
      const vendor      = normalizeNonEmptyString(meta?.vendor_name)?.toLowerCase() ?? '';
      const categoryKey = toTruthKey(meta?.category_codes);
      if (brand === '' || vendor === '' || categoryKey === '') return null;
      return { brand, vendor, categoryKey };
    };
    const truthFromVariant = (v: any): ModelTruth | null => {
      const brand       = normalizeNonEmptyString(v?.brand)?.toLowerCase()       ?? '';
      const vendor      = normalizeNonEmptyString(v?.vendor_name)?.toLowerCase() ?? '';
      const categoryKey = toTruthKey(v?.category_codes);
      if (brand === '' || vendor === '' || categoryKey === '') return null;
      return { brand, vendor, categoryKey };
    };

    // Pre-build truth map from model metadata (parent rows already scanned)
    const truthByModelCode = new Map<string, ModelTruth>();
    for (const [modelCode, meta] of modelMetadataByCode) {
      const t = truthFromMeta(meta);
      if (t) truthByModelCode.set(modelCode, t);
    }

    // Determine if a parent row is "sellable" (has price + stock + image + required fields)
    const isSellableParentRow = (p: any): boolean => {
      const productCode = normalizeNonEmptyString(p.product_code);
      if (!productCode) return false;
      const hasName       = normalizeNonEmptyString(p.product_name_en);
      const hasBrand      = normalizeNonEmptyString(p.brand);
      const hasVendor     = normalizeNonEmptyString(p.vendor_name);
      const hasCategories = normalizeCategoryCodesFromCsv(p.categories).length > 0;
      const barcode       = normalizeNonEmptyString(p.barcode);
      const hasBarcode    = typeof barcode === 'string' && /^\d+$/.test(barcode);
      const price         = priceMap.get(productCode);
      const stock         = stockMap.get(productCode);
      const image         = imageMap.get(productCode);
      return Boolean(hasName && hasBrand && hasVendor && hasCategories && hasBarcode && price && stock && image);
    };

    // Streaming state
    let droppedVariants = 0;
    const droppedModelCodes    = new Set<string>();
    const eligibleModelSet     = new Set<string>();
    const validVariantCountByModel = new Map<string, number>();

    // Batch accumulators — flushed every PRODUCT_BATCH_SIZE rows
    let stagingProductBatch: any[]  = [];
    let stagingPriceBatch:   any[]  = [];
    let stagingStockBatch:   any[]  = [];
    let stagingImageBatch:   any[]  = [];
    let variantBatch:        any[]  = [];

    let totalProductRows = 0;
    let totalEnriched    = 0;

    const modelLimit = config.pipelineModelLimit;

    const flushBatch = async (): Promise<void> => {
      if (stagingProductBatch.length === 0) return;

      if (stagingProductBatch.length > 0) await insertProductsStaging(stagingProductBatch);
      if (stagingPriceBatch.length   > 0) await insertPricesStaging(stagingPriceBatch);
      if (stagingStockBatch.length   > 0) await insertStockStaging(stagingStockBatch, 'product_code');
      if (stagingImageBatch.length   > 0) await insertImagesStaging(stagingImageBatch);
      if (variantBatch.length        > 0) await promoteToProduction(variantBatch, { modelMetadataByCode });

      stagingProductBatch = [];
      stagingPriceBatch   = [];
      stagingStockBatch   = [];
      stagingImageBatch   = [];
      variantBatch        = [];
    };

    if (fs.existsSync(productsPath)) {
      await parseProductsCsv(productsPath, async (rawRow) => {
        normalizeHyphenKeysInPlace(rawRow);
        totalProductRows++;

        const parent = normalizeNonEmptyString(rawRow.parent);
        const isVariantRow = Boolean(parent);
        const isSellableParent = !isVariantRow && isSellableParentRow(rawRow);

        // Only process rows that are either variants or sellable parents
        if (!isVariantRow && !isSellableParent) return;

        const productCode = normalizeNonEmptyString(rawRow.product_code);
        if (!productCode) return;

        // Apply model cap: skip rows whose model is already capped out
        const modelCode = isVariantRow
          ? (normalizeNonEmptyString(rawRow.parent) ?? productCode)
          : productCode;

        if (modelLimit > 0 && eligibleModelSet.size >= modelLimit) {
          // Only allow rows belonging to already-eligible models
          if (!eligibleModelSet.has(modelCode)) return;
        }

        const price = priceMap.get(productCode);
        const stock = stockMap.get(productCode);
        const image = imageMap.get(productCode);

        const enriched = validator.enrichProduct(
          rawRow,
          price,
          stock,
          image ? { IMAGE_URL: image.IMAGE_URL } : undefined,
        );
        totalEnriched++;

        // Model-consistency check
        const truth = truthByModelCode.get(modelCode);
        if (truth) {
          const vt = truthFromVariant(enriched);
          if (vt && (vt.brand !== truth.brand || vt.vendor !== truth.vendor || vt.categoryKey !== truth.categoryKey)) {
            droppedVariants++;
            droppedModelCodes.add(modelCode);
            return;
          }
        } else {
          // First time we see this model from a variant — register its truth
          const vt = truthFromVariant(enriched);
          if (vt) truthByModelCode.set(modelCode, vt);
        }

        // Filter check
        const passes = productFilter.filterProducts([enriched]).length > 0;

        if (passes) {
          eligibleModelSet.add(modelCode);
        }

        // Track valid variant count for model ordering (used in cap logic)
        if (Array.isArray(enriched.errors) && enriched.errors.length === 0) {
          validVariantCountByModel.set(modelCode, (validVariantCountByModel.get(modelCode) ?? 0) + 1);
        }

        // Accumulate into staging + production batches
        stagingProductBatch.push(rawRow);
        if (price) stagingPriceBatch.push(price);
        if (stock) stagingStockBatch.push(stock);
        if (image) stagingImageBatch.push(image);
        variantBatch.push(enriched);

        // Flush when batch is full
        if (stagingProductBatch.length >= PRODUCT_BATCH_SIZE) {
          await flushBatch();
        }
      }, log);
    }

    // Flush any remaining rows
    await flushBatch();

    if (droppedVariants > 0) {
      log.warn(`Dropped ${droppedVariants} variants conflicting with model truth (${droppedModelCodes.size} models affected)`);
    }

    log.info(`Streamed ${totalProductRows} product rows, enriched ${totalEnriched} variants`);

    pipelineModels   = modelLimit > 0 ? Math.min(eligibleModelSet.size, modelLimit) : eligibleModelSet.size;
    pipelineVariants = totalEnriched - droppedVariants;

    if (modelLimit > 0) {
      log.info(`Applied model cap: ${pipelineModels} models (limit: ${modelLimit})`);
    } else {
      log.info(`No model cap (prod): ${pipelineModels} models, ${pipelineVariants} variants`);
    }

    if (config.dev.cleanSlate) {
      await clearProductionProductsForDev();
      await clearStagingTablesForDev();
    }

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

// Schedule the job
if (config.nodeEnv !== 'test') {
  cron.schedule(config.cron.schedule, async () => {
    try {
      await runPipeline();
    } catch (error) {
      const err = error as Error;
      logger.error('Scheduled job failed', { error: err.message });
    }
  });
  logger.info('Cron job scheduled', { schedule: config.cron.schedule });
}

// For manual testing
if (require.main === module) {
  runPipeline().catch(console.error);
}
