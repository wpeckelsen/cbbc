import { config } from './src/config/env';
import { logger } from './src/logger';
import { FtpClient } from './src/ftp/ftp-client';
import { parseProductsCsv, parsePricesCsv, parseStockCsv, parseCategoriesCsv, parseCategoryHierarchyCsv, parseImagesCsv } from './src/parsers/csv-parser';
import { ProductValidator } from './src/validation/product-validator';
import { insertProductsStaging, insertPricesStaging, insertStockStaging, insertCategories, insertCategoryHierarchy, insertImagesStaging, promoteToProduction } from './src/api/products-api';
import fs from 'fs';
import path from 'path';

async function runPipeline(): Promise<void> {
  logger.info('Starting FTP product pipeline TEST');
  logger.info('Database URL:', { url: config.database.url.replace(/:[^:@]+@/, ':***@') });

  const ftpClient = new FtpClient();
  const validator = new ProductValidator();

  try {
    // Step 1: Connect to FTP
    await ftpClient.connect();

    // Use cache directory for downloads (persists across runs)
    const cacheDir = path.join(__dirname, 'cache/ftp');
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

    logger.info('Parsed all files', { 
      products: products.length, 
      prices: prices.length, 
      stockProduct: stockProduct.length,
      stockEan: stockEan.length,
      categories: categories.length,
      categoryHierarchy: categoryHierarchy.length,
      images: images.length
    });

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

    logger.info('Validated products', { count: validatedProducts.length });

    // Step 6: Promote to production (limited to 10 for MVP)
    await promoteToProduction(validatedProducts);

    // Cache files are kept for subsequent runs (no cleanup)
    logger.info('Pipeline completed successfully! Check your Supabase database. (cached files preserved in cache/ftp/)');
    process.exit(0);
  } catch (error) {
    const err = error as Error;
    logger.error('Pipeline failed', { error: err.message, stack: err.stack });
    console.error('\n=== FULL ERROR DETAILS ===');
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    console.error('=========================\n');
    process.exit(1);
  } finally {
    await ftpClient.disconnect();
  }
}


runPipeline();
