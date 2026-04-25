import * as cron from 'node-cron';
import { config } from './config/env';
import { logger } from './logger';
import "dotenv/config";
import { FtpClient } from './ftp/ftp-client';
import { parseProductsCsv, parsePricesCsv, parseStockCsv, parseCategoriesCsv, parseCategoryHierarchyCsv, parseImagesCsv } from './parsers/csv-parser';
import { ProductValidator } from './validation/product-validator';
import { ProductFilter } from './filters/product-filter';
import { insertProductsStaging, insertPricesStaging, insertStockStaging, insertCategories, insertCategoryHierarchy, insertImagesStaging, promoteToProduction } from './api/products-api';
import { logBoundarySample } from './utils/pipeline-debug';
import fs from 'fs';
import path from 'path';

async function runPipeline(): Promise<void> {
  logger.info('Starting FTP product pipeline');

  const ftpClient = new FtpClient();
  const validator = new ProductValidator();
  const productFilter = new ProductFilter();

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
      { remote: '/ic_ean_CSV.csv', local: path.join(cacheDir, 'stock_ean.csv') },
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
    const prices = fs.existsSync(path.join(cacheDir, 'prices.csv')) ? await parsePricesCsv(path.join(cacheDir, 'prices.csv')) : [];
    const stockProduct = fs.existsSync(path.join(cacheDir, 'stock_product.csv')) ? await parseStockCsv(path.join(cacheDir, 'stock_product.csv'), 'product_code') : [];
    const stockEan = fs.existsSync(path.join(cacheDir, 'stock_ean.csv')) ? await parseStockCsv(path.join(cacheDir, 'stock_ean.csv'), 'ean') : [];
    const categories = fs.existsSync(path.join(cacheDir, 'categories.csv')) ? await parseCategoriesCsv(path.join(cacheDir, 'categories.csv')) : [];
    const categoryHierarchy = fs.existsSync(path.join(cacheDir, 'category_hierarchy.csv')) ? await parseCategoryHierarchyCsv(path.join(cacheDir, 'category_hierarchy.csv')) : [];
    const images = fs.existsSync(path.join(cacheDir, 'images.csv')) ? await parseImagesCsv(path.join(cacheDir, 'images.csv')) : [];

    logBoundarySample('post-parse:products', products as any);
    logBoundarySample('post-parse:prices', prices as any);
    logBoundarySample('post-parse:stock_product', stockProduct as any);
    logBoundarySample('post-parse:stock_ean', stockEan as any);
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
    const validatedProducts = products.map(product => {
      const price = priceMap.get(product.product_code);
      const stock = stockMap.get(product.product_code);
      const image = imageMap.get(product.product_code);
      return validator.enrichProduct(product, price, stock, image ? { IMAGE_URL: image.IMAGE_URL } : undefined);
    });
    logger.info('Enrichment complete');

    logBoundarySample('post-validate:validated_products', validatedProducts as any);

    // Step 6: Apply filters to reduce dataset
    logger.info(`Pre-filter: ${validatedProducts.length} validated products`);
    const filterStats = productFilter.getFilterStats(validatedProducts);
    logger.info('Filter statistics', {
        total: filterStats.total,
        passed: filterStats.passed,
        failed: filterStats.failed,
        passRate: filterStats.passRate,
        failureReasons: filterStats.failureReasons, // Explicitly log failure reasons
    });
    
    const filteredProducts = productFilter.filterProducts(validatedProducts);
    logger.info(`Post-filter: ${filteredProducts.length} products passed filter`);

    // Step 7: Apply hard cap (MVP: 10 products, later: 5000)
    const MVP_PRODUCT_LIMIT = 10;
    const cappedProducts = filteredProducts.slice(0, MVP_PRODUCT_LIMIT);
    logger.info(`Applied hard cap: ${cappedProducts.length} products (limit: ${MVP_PRODUCT_LIMIT})`);

    // Step 8: Extract product codes for filtered products
    const cappedProductCodes = new Set(cappedProducts.map(p => p.product_code));

    // Step 9: Filter related data to match only the capped products
    const cappedPrices = prices.filter(p => cappedProductCodes.has(p.PRODUCT_CODE));
    const cappedStockProduct = stockProduct.filter(s => cappedProductCodes.has(s.PRODUCT_CODE));
    const cappedStockEan = stockEan.filter(s => cappedProductCodes.has(s.EAN));
    const cappedImages = images.filter(i => cappedProductCodes.has(i.PRODUCT_CODE));

    logger.info(`Filtered related data: ${cappedPrices.length} prices, ${cappedStockProduct.length} stock records, ${cappedImages.length} images`);

    // Step 10: Insert ONLY filtered data to staging (not all 127k products!)
    if (cappedProducts.length > 0) await insertProductsStaging(cappedProducts);
    if (cappedPrices.length > 0) await insertPricesStaging(cappedPrices);
    if (cappedStockProduct.length > 0) await insertStockStaging(cappedStockProduct, 'product_code');
    if (cappedStockEan.length > 0) await insertStockStaging(cappedStockEan, 'ean');
    if (categories.length > 0) await insertCategories(categories);
    if (categoryHierarchy.length > 0) await insertCategoryHierarchy(categoryHierarchy);
    if (cappedImages.length > 0) await insertImagesStaging(cappedImages);

    // Step 11: Promote filtered products to production
    await promoteToProduction(cappedProducts);

    // Pre-Ecwid boundary placeholder (Ecwid sync not implemented yet)
    logBoundarySample('pre-ecwid:products', cappedProducts as any, { maxStringLen: 80 });

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