import * as cron from 'node-cron';
import { config } from './config/env';
import { logger } from './logger';
import "dotenv/config";
import { FtpClient } from './ftp/ftp-client';
import { parseProductsCsv, parsePricesCsv, parseStockCsv, parseCategoriesCsv, parseCategoryHierarchyCsv, parseImagesCsv } from './parsers/csv-parser';
import { ProductValidator } from './validation/product-validator';
import { ProductFilter } from './filters/product-filter';
import { insertProductsStaging, insertPricesStaging, insertStockStaging, insertCategories, insertCategoryHierarchy, insertImagesStaging, promoteToProduction, clearProductionProductsForDev, clearStagingTablesForDev } from './api/products-api';
import { logBoundarySample } from './utils/pipeline-debug';
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

function isConsistentModelGroup(variants: any[]): boolean {
  if (variants.length <= 1) return true;
  const first = variants[0];
  const brand = typeof first.brand === 'string' ? first.brand.trim() : '';
  const vendor = typeof first.vendor_name === 'string' ? first.vendor_name.trim() : '';
  const categoryKey = normalizeCategoryCodes(first.category_codes).join('|');

  for (const v of variants) {
    const b = typeof v.brand === 'string' ? v.brand.trim() : '';
    const vn = typeof v.vendor_name === 'string' ? v.vendor_name.trim() : '';
    const ck = normalizeCategoryCodes(v.category_codes).join('|');
    if (b !== brand || vn !== vendor || ck !== categoryKey) return false;
  }
  return true;
}

async function runPipeline(): Promise<void> {
  logger.info('Starting FTP product pipeline');

  const ftpClient = new FtpClient();
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
  });

  try {
    // Step 1: Connect to FTP
    await ftpClient.connect();

    // Use cache directory for downloads (persists across runs)
    const cacheDir = path.join(__dirname, '../../cache/ftp');
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

    for (const file of filesToDownload) {
      try {
        await ftpClient.downloadWithCache(file.remote, file.local);
      } catch (error) {
        const err = error as Error;
        logger.warn(`Failed to download ${file.remote}, skipping`, { error: err.message });
      }
    }

    // Step 3: Parse files
    const products = fs.existsSync(path.join(cacheDir, 'products.csv')) ? await parseProductsCsv(path.join(cacheDir, 'products.csv')) : [];
    for (const p of products) normalizeHyphenKeysInPlace(p);
    const prices = fs.existsSync(path.join(cacheDir, 'prices.csv')) ? await parsePricesCsv(path.join(cacheDir, 'prices.csv')) : [];
    const stockProduct = fs.existsSync(path.join(cacheDir, 'stock_product.csv')) ? await parseStockCsv(path.join(cacheDir, 'stock_product.csv'), 'product_code') : [];
    const categories = fs.existsSync(path.join(cacheDir, 'categories.csv')) ? await parseCategoriesCsv(path.join(cacheDir, 'categories.csv')) : [];
    const categoryHierarchy = fs.existsSync(path.join(cacheDir, 'category_hierarchy.csv')) ? await parseCategoryHierarchyCsv(path.join(cacheDir, 'category_hierarchy.csv')) : [];
    const images = fs.existsSync(path.join(cacheDir, 'images.csv')) ? await parseImagesCsv(path.join(cacheDir, 'images.csv')) : [];

    logBoundarySample('post-parse:products', products as any);
    logBoundarySample('post-parse:prices', prices as any);
    logBoundarySample('post-parse:stock_product', stockProduct as any);
    logBoundarySample('post-parse:categories', categories as any);
    logBoundarySample('post-parse:category_hierarchy', categoryHierarchy as any);
    logBoundarySample('post-parse:images', images as any);

    logger.info(`Parsed ${products.length} products from FTP`);

    // Step 4: Build lookup maps for O(1) access (avoid O(n²) .find() loops)
    logger.info('Building lookup maps for prices, stock, and images...');
    const priceMap = new Map(prices.map(p => [p.PRODUCT_CODE, p]));
    const stockMap = new Map(stockProduct.map(s => [s.PRODUCT_CODE, s]));
    const imageMap = new Map(images.map(i => [i.PRODUCT_CODE, i]));
    logger.info('Lookup maps built', { prices: priceMap.size, stock: stockMap.size, images: imageMap.size });

    // Step 5: Validate and enrich products (in-memory, before sending to DB)
    logger.info('Enriching products...');
    const parentRows: any[] = [];
    const variantRows: any[] = [];
    for (const p of products) {
      const parent = normalizeNonEmptyString(p.parent);
      if (parent) variantRows.push(p);
      else parentRows.push(p);
    }

    logger.info('Split products feed', {
      total: products.length,
      parentRows: parentRows.length,
      variantRows: variantRows.length,
    });

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
      });
    }

    logger.info('Built model metadata map from parent rows', {
      modelsWithParentRow: modelMetadataByCode.size,
    });

    const isSellableParentRow = (p: any): boolean => {
      const productCode = normalizeNonEmptyString(p.product_code);
      if (!productCode) return false;

      const hasName = normalizeNonEmptyString(p.product_name_en);
      const hasBrand = normalizeNonEmptyString(p.brand);
      const hasVendor = normalizeNonEmptyString(p.vendor_name);
      const hasCategories = normalizeCategoryCodesFromCsv(p.categories).length > 0;
      const barcode = normalizeNonEmptyString(p.barcode);
      const hasBarcode = typeof barcode === 'string' && /^\d+$/.test(barcode);

      const price = priceMap.get(productCode);
      const stock = stockMap.get(productCode);
      const image = imageMap.get(productCode);

      return Boolean(hasName && hasBrand && hasVendor && hasCategories && hasBarcode && price && stock && image);
    };

    const sellableParentRows = parentRows.filter(isSellableParentRow);
    const rowsToEnrich = [...variantRows, ...sellableParentRows];

    if (sellableParentRows.length > 0) {
      logger.info('Included sellable parent rows as variants', {
        sellableParentRows: sellableParentRows.length,
      });
    }

    const validatedProducts = rowsToEnrich.map((product) => {
      const price = priceMap.get(product.product_code);
      const stock = stockMap.get(product.product_code);
      const image = imageMap.get(product.product_code);
      return validator.enrichProduct(product, price, stock, image ? { IMAGE_URL: image.IMAGE_URL } : undefined);
    });
    logger.info('Enrichment complete');

    logBoundarySample('post-validate:validated_products', validatedProducts as any);

    // Step 6: Reject inconsistent models (brand/vendor/category mismatch)
    type ModelTruth = { brand: string; vendor: string; categoryKey: string };
    const toTruthKey = (codes: any): string => {
      const normalized = normalizeCategoryCodes(codes).map((c) => c.toLowerCase());
      return normalized.join('|');
    };
    const truthFromMeta = (meta: any): ModelTruth | null => {
      const brand = normalizeNonEmptyString(meta?.brand)?.toLowerCase() ?? '';
      const vendor = normalizeNonEmptyString(meta?.vendor_name)?.toLowerCase() ?? '';
      const categoryKey = toTruthKey(meta?.category_codes);
      if (brand === '' || vendor === '' || categoryKey === '') return null;
      return { brand, vendor, categoryKey };
    };
    const truthFromVariant = (v: any): ModelTruth | null => {
      const brand = normalizeNonEmptyString(v?.brand)?.toLowerCase() ?? '';
      const vendor = normalizeNonEmptyString(v?.vendor_name)?.toLowerCase() ?? '';
      const categoryKey = toTruthKey(v?.category_codes);
      if (brand === '' || vendor === '' || categoryKey === '') return null;
      return { brand, vendor, categoryKey };
    };

    const variantsByModel = new Map<string, any[]>();
    for (const v of validatedProducts) {
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      const arr = variantsByModel.get(modelCode) ?? [];
      arr.push(v);
      variantsByModel.set(modelCode, arr);
    }

    const truthByModelCode = new Map<string, ModelTruth>();
    for (const [modelCode, meta] of modelMetadataByCode) {
      const t = truthFromMeta(meta);
      if (t) truthByModelCode.set(modelCode, t);
    }
    for (const [modelCode, variants] of variantsByModel) {
      if (truthByModelCode.has(modelCode)) continue;
      for (const v of variants) {
        const t = truthFromVariant(v);
        if (t) {
          truthByModelCode.set(modelCode, t);
          break;
        }
      }
    }

    let droppedVariants = 0;
    const droppedModelCodes = new Set<string>();
    const consistentValidatedVariants = validatedProducts.filter((v) => {
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      const truth = truthByModelCode.get(modelCode);
      if (!truth) return true;
      const vt = truthFromVariant(v);
      if (!vt) return true;
      if (vt.brand !== truth.brand || vt.vendor !== truth.vendor || vt.categoryKey !== truth.categoryKey) {
        droppedVariants += 1;
        droppedModelCodes.add(modelCode);
        return false;
      }
      return true;
    });

    if (droppedVariants > 0) {
      logger.warn(
        {
          droppedVariants,
          affectedModels: droppedModelCodes.size,
          totalModels: variantsByModel.size,
        },
        'Dropped variants conflicting with model truth (parent-preferred)'
      );
    }

    // Step 7: Determine model eligibility via qualifying variants (stock_total > 1)
    logger.info(`Pre-filter: ${consistentValidatedVariants.length} validated variants (consistent models only)`);
    const filterStats = productFilter.getFilterStats(consistentValidatedVariants);
    logger.info('Filter statistics', {
      total: filterStats.total,
      passed: filterStats.passed,
      failed: filterStats.failed,
      passRate: filterStats.passRate,
      failureReasons: filterStats.failureReasons,
    });

    const qualifyingVariants = productFilter.filterProducts(consistentValidatedVariants);
    logger.info(`Post-filter: ${qualifyingVariants.length} variants passed filter (qualifying variants)`);

    // Step 8: Eligible models are those with >= 1 qualifying variant, then cap by model count
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

    const MVP_MODEL_LIMIT = 50;
    const cappedModelCodes = eligibleModelOrder.slice(0, MVP_MODEL_LIMIT);
    const cappedModelCodeSet = new Set<string>(cappedModelCodes);
    const cappedVariantsToPromote = variantsToPromote.filter((v) => {
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      return cappedModelCodeSet.has(modelCode);
    });

    logger.info('Applied hard cap (models)', {
      models: cappedModelCodes.length,
      variants: cappedVariantsToPromote.length,
      limit: MVP_MODEL_LIMIT,
    });

    const variantsPerModel = new Map<string, number>();
    for (const v of cappedVariantsToPromote) {
      const modelCode = typeof v.model_code === 'string' && v.model_code.trim() !== '' ? v.model_code.trim() : v.product_code;
      variantsPerModel.set(modelCode, (variantsPerModel.get(modelCode) ?? 0) + 1);
    }
    const multiVariantModels = Array.from(variantsPerModel.values()).filter((n) => n > 1).length;
    const maxVariantsInModel = Math.max(0, ...Array.from(variantsPerModel.values()));
    logger.info('Variants per model (post-cap)', {
      models: variantsPerModel.size,
      multiVariantModels,
      maxVariantsInModel,
    });

    // Step 9: Filter related data to match only the selected variant SKUs
    const cappedProductCodes = new Set(cappedVariantsToPromote.map((v) => v.product_code));
    const cappedRawProducts = products.filter((p) => cappedProductCodes.has(p.product_code));
    const cappedPrices = prices.filter((p) => cappedProductCodes.has(p.PRODUCT_CODE));
    const cappedStockProduct = stockProduct.filter((s) => typeof s.PRODUCT_CODE === 'string' && cappedProductCodes.has(s.PRODUCT_CODE));
    const cappedImages = images.filter((i) => cappedProductCodes.has(i.PRODUCT_CODE));

    logger.info(`Filtered related data: ${cappedPrices.length} prices, ${cappedStockProduct.length} stock records, ${cappedImages.length} images`);

    // Step 10: Insert ONLY filtered data to staging (not all 127k variants!)
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

    logBoundarySample('pre-store-sync:products', cappedVariantsToPromote as any, { maxStringLen: 80 });

    // Cache files are kept for subsequent runs (no cleanup)
    logger.info('Pipeline completed successfully (cached files preserved in cache/ftp/)');
  } catch (error) {
    const err = error as Error;
    logger.error('Pipeline failed', { error: err.message, stack: err.stack });
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