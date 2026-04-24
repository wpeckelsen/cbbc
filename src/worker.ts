import * as cron from 'node-cron';
import { config } from './config/env';
import { logger } from './logger';
import { FtpClient } from './ftp/ftp-client';
import { parseProductsCsv, parsePricesCsv, parseStockCsv, parseCategoriesCsv, parseCategoryHierarchyCsv, parseImagesCsv } from './parsers/csv-parser';
import { ProductValidator } from './validation/product-validator';
import { insertProductsStaging, insertPricesStaging, insertStockStaging, insertCategories, insertCategoryHierarchy, insertImagesStaging } from './db/staging';
import { promoteToProduction } from './db/promotion';
import fs from 'fs';
import path from 'path';

async function runPipeline(): Promise<void> {
  logger.info('Starting FTP product pipeline');

  const ftpClient = new FtpClient();
  const validator = new ProductValidator();

  try {
    // Step 1: Connect to FTP
    await ftpClient.connect();

    // Create temp directory for downloads
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    // Step 2: Download files
    const filesToDownload = [
      { remote: '/Data/Products/products.csv', local: path.join(tempDir, 'products.csv') },
      { remote: '/Retail_pricelist.csv', local: path.join(tempDir, 'prices.csv') },
      { remote: '/ic_CSV.csv', local: path.join(tempDir, 'stock_product.csv') },
      { remote: '/ic_ean_CSV.csv', local: path.join(tempDir, 'stock_ean.csv') },
      { remote: '/Data/product_category_descriptions.csv', local: path.join(tempDir, 'categories.csv') },
      { remote: '/Data/product_category_hierarchy.csv', local: path.join(tempDir, 'category_hierarchy.csv') },
      { remote: '/Data/product_images.csv', local: path.join(tempDir, 'images.csv') },
    ];

    for (const file of filesToDownload) {
      try {
        await ftpClient.downloadWithRetry(file.remote, file.local);
      } catch (error) {
        const err = error as Error;
        logger.warn(`Failed to download ${file.remote}, skipping`, { error: err.message });
      }
    }

    // Step 3: Parse files
    const products = fs.existsSync(path.join(tempDir, 'products.csv')) ? await parseProductsCsv(path.join(tempDir, 'products.csv')) : [];
    const prices = fs.existsSync(path.join(tempDir, 'prices.csv')) ? await parsePricesCsv(path.join(tempDir, 'prices.csv')) : [];
    const stockProduct = fs.existsSync(path.join(tempDir, 'stock_product.csv')) ? await parseStockCsv(path.join(tempDir, 'stock_product.csv'), 'product_code') : [];
    const stockEan = fs.existsSync(path.join(tempDir, 'stock_ean.csv')) ? await parseStockCsv(path.join(tempDir, 'stock_ean.csv'), 'ean') : [];
    const categories = fs.existsSync(path.join(tempDir, 'categories.csv')) ? await parseCategoriesCsv(path.join(tempDir, 'categories.csv')) : [];
    const categoryHierarchy = fs.existsSync(path.join(tempDir, 'category_hierarchy.csv')) ? await parseCategoryHierarchyCsv(path.join(tempDir, 'category_hierarchy.csv')) : [];
    const images = fs.existsSync(path.join(tempDir, 'images.csv')) ? await parseImagesCsv(path.join(tempDir, 'images.csv')) : [];

    // Step 4: Insert to staging
    if (products.length > 0) await insertProductsStaging(products);
    if (prices.length > 0) await insertPricesStaging(prices);
    if (stockProduct.length > 0) await insertStockStaging(stockProduct, 'product_code');
    if (stockEan.length > 0) await insertStockStaging(stockEan, 'ean');
    if (categories.length > 0) await insertCategories(categories);
    if (categoryHierarchy.length > 0) await insertCategoryHierarchy(categoryHierarchy);
    if (images.length > 0) await insertImagesStaging(images);

    // Step 5: Validate and enrich products
    const validatedProducts = products.map(product => {
      // Find matching price, stock, image
      const price = prices.find(p => p.PRODUCT_CODE === product.product_code);
      const stock = stockProduct.find(s => s.PRODUCT_CODE === product.product_code);
      const image = images.find(i => i.PRODUCT_CODE === product.product_code);
      return validator.enrichProduct(product, price, stock, image ? { IMAGE_URL: image.IMAGE_URL } : undefined);
    });

    // Step 6: Promote to production (limited to 10 for MVP)
    await promoteToProduction(validatedProducts);

    // Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true });

    logger.info('Pipeline completed successfully');
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