import { pool } from '../config/database';
import { ProductRecord, PriceRecord, StockRecord, CategoryRecord, CategoryHierarchyRecord, ImageRecord } from '../parsers/csv-parser';
import { logger } from '../logger';
import crypto from 'crypto';

export async function insertProductsStaging(products: ProductRecord[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      INSERT INTO products_staging (
        product_code, categories, family, parent, one_variant, customs_pos,
        product_model_name_en, product_model_name_fi, product_model_name_sv,
        vendor_name, country_origin, vak_code, yk_no, supplier_product_code,
        catalog_restriction, material, make_model, brand,
        short_description_en, short_description_fi, short_description_sv,
        long_description_en, long_description_fi, long_description_sv,
        product_name_en, product_name_fi, product_name_sv, barcode,
        created, updated, raw_hash, imported_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
      ON CONFLICT (product_code) DO UPDATE SET
        categories = EXCLUDED.categories,
        family = EXCLUDED.family,
        parent = EXCLUDED.parent,
        one_variant = EXCLUDED.one_variant,
        customs_pos = EXCLUDED.customs_pos,
        product_model_name_en = EXCLUDED.product_model_name_en,
        product_model_name_fi = EXCLUDED.product_model_name_fi,
        product_model_name_sv = EXCLUDED.product_model_name_sv,
        vendor_name = EXCLUDED.vendor_name,
        country_origin = EXCLUDED.country_origin,
        vak_code = EXCLUDED.vak_code,
        yk_no = EXCLUDED.yk_no,
        supplier_product_code = EXCLUDED.supplier_product_code,
        catalog_restriction = EXCLUDED.catalog_restriction,
        material = EXCLUDED.material,
        make_model = EXCLUDED.make_model,
        brand = EXCLUDED.brand,
        short_description_en = EXCLUDED.short_description_en,
        short_description_fi = EXCLUDED.short_description_fi,
        short_description_sv = EXCLUDED.short_description_sv,
        long_description_en = EXCLUDED.long_description_en,
        long_description_fi = EXCLUDED.long_description_fi,
        long_description_sv = EXCLUDED.long_description_sv,
        product_name_en = EXCLUDED.product_name_en,
        product_name_fi = EXCLUDED.product_name_fi,
        product_name_sv = EXCLUDED.product_name_sv,
        barcode = EXCLUDED.barcode,
        created = EXCLUDED.created,
        updated = EXCLUDED.updated,
        raw_hash = EXCLUDED.raw_hash,
        imported_at = EXCLUDED.imported_at
    `;
    for (const product of products) {
      const hash = crypto.createHash('sha256').update(JSON.stringify(product)).digest('hex');
      const values = [
        product.product_code, product.categories, product.family, product.parent,
        product.one_variant === '1' || product.one_variant?.toLowerCase() === 'true',
        product.customs_pos, product.product_model_name_en, product.product_model_name_fi, product.product_model_name_sv,
        product.vendor_name, product.country_origin, product.vak_code, product.yk_no, product.supplier_product_code,
        product.catalog_restriction, product.material, product.make_model, product.brand,
        product.short_description_en, product.short_description_fi, product.short_description_sv,
        product.long_description_en, product.long_description_fi, product.long_description_sv,
        product.product_name_en, product.product_name_fi, product.product_name_sv, product.barcode,
        product.created ? new Date(product.created) : null, product.updated ? new Date(product.updated) : null,
        hash, new Date()
      ];
      await client.query(query, values);
    }
    await client.query('COMMIT');
    logger.info('Inserted products into staging', { count: products.length });
  } catch (error) {
    await client.query('ROLLBACK');
    const err = error as Error;
    logger.error('Failed to insert products staging', { error: err.message });
    throw error;
  } finally {
    client.release();
  }
}

export async function insertPricesStaging(prices: PriceRecord[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      INSERT INTO prices_staging (
        product_code, eur_excl_vat, eur_incl_vat, eur_excl_vat_eu, eur_incl_vat_eu,
        sek_excl_vat, sek_incl_vat, nok_excl_vat, nok_incl_vat, gbp_excl_vat, dkk_excl_vat, dkk_incl_vat, imported_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (product_code) DO UPDATE SET
        eur_excl_vat = EXCLUDED.eur_excl_vat,
        eur_incl_vat = EXCLUDED.eur_incl_vat,
        eur_excl_vat_eu = EXCLUDED.eur_excl_vat_eu,
        eur_incl_vat_eu = EXCLUDED.eur_incl_vat_eu,
        sek_excl_vat = EXCLUDED.sek_excl_vat,
        sek_incl_vat = EXCLUDED.sek_incl_vat,
        nok_excl_vat = EXCLUDED.nok_excl_vat,
        nok_incl_vat = EXCLUDED.nok_incl_vat,
        gbp_excl_vat = EXCLUDED.gbp_excl_vat,
        dkk_excl_vat = EXCLUDED.dkk_excl_vat,
        dkk_incl_vat = EXCLUDED.dkk_incl_vat,
        imported_at = EXCLUDED.imported_at
    `;
    for (const price of prices) {
      const values = [
        price.PRODUCT_CODE,
        price.EUR_EXCL_VAT ? parseFloat(price.EUR_EXCL_VAT) : null,
        price.EUR_INCL_VAT ? parseFloat(price.EUR_INCL_VAT) : null,
        price.EUR_EXCL_VAT_EU ? parseFloat(price.EUR_EXCL_VAT_EU) : null,
        price.EUR_INCL_VAT_EU ? parseFloat(price.EUR_INCL_VAT_EU) : null,
        price.SEK_EXCL_VAT ? parseFloat(price.SEK_EXCL_VAT) : null,
        price.SEK_INCL_VAT ? parseFloat(price.SEK_INCL_VAT) : null,
        price.NOK_EXCL_VAT ? parseFloat(price.NOK_EXCL_VAT) : null,
        price.NOK_INCL_VAT ? parseFloat(price.NOK_INCL_VAT) : null,
        price.GBP_EXCL_VAT ? parseFloat(price.GBP_EXCL_VAT) : null,
        price.DKK_EXCL_VAT ? parseFloat(price.DKK_EXCL_VAT) : null,
        price.DKK_INCL_VAT ? parseFloat(price.DKK_INCL_VAT) : null,
        new Date()
      ];
      await client.query(query, values);
    }
    await client.query('COMMIT');
    logger.info('Inserted prices into staging', { count: prices.length });
  } catch (error) {
    await client.query('ROLLBACK');
    const err = error as Error;
    logger.error('Failed to insert prices staging', { error: err.message });
    throw error;
  } finally {
    client.release();
  }
}

export async function insertStockStaging(stocks: StockRecord[], source: 'product_code' | 'ean'): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      INSERT INTO stock_staging (
        product_code, ean, vaasa, sweden, total, source, imported_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (product_code, source) DO UPDATE SET
        ean = EXCLUDED.ean,
        vaasa = EXCLUDED.vaasa,
        sweden = EXCLUDED.sweden,
        total = EXCLUDED.total,
        imported_at = EXCLUDED.imported_at
    `;
    for (const stock of stocks) {
      const values = [
        stock.PRODUCT_CODE || null,
        stock.EAN || null,
        stock.VAASA ? parseInt(stock.VAASA, 10) : null,
        stock.SWEDEN ? parseInt(stock.SWEDEN, 10) : null,
        stock.TOTAL ? parseInt(stock.TOTAL, 10) : null,
        source,
        new Date()
      ];
      await client.query(query, values);
    }
    await client.query('COMMIT');
    logger.info('Inserted stock into staging', { source, count: stocks.length });
  } catch (error) {
    await client.query('ROLLBACK');
    const err = error as Error;
    logger.error('Failed to insert stock staging', { error: err.message });
    throw error;
  } finally {
    client.release();
  }
}

export async function insertCategories(categories: CategoryRecord[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      INSERT INTO categories (id, code, description, language_number)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code,
        description = EXCLUDED.description,
        language_number = EXCLUDED.language_number
    `;
    for (const cat of categories) {
      const values = [cat.ID, cat.CODE, cat.DESCRIPTION, parseInt(cat.LANGUAGE_NUMBER, 10)];
      await client.query(query, values);
    }
    await client.query('COMMIT');
    logger.info('Inserted categories', { count: categories.length });
  } catch (error) {
    await client.query('ROLLBACK');
    const err = error as Error;
    logger.error('Failed to insert categories', { error: err.message });
    throw error;
  } finally {
    client.release();
  }
}

export async function insertCategoryHierarchy(hierarchies: CategoryHierarchyRecord[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      INSERT INTO category_hierarchy (id, prev_category, category_level)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        prev_category = EXCLUDED.prev_category,
        category_level = EXCLUDED.category_level
    `;
    for (const hier of hierarchies) {
      const values = [hier.ID, hier.PREV_CATEGORY, parseInt(hier.CATEGORY_LEVEL, 10)];
      await client.query(query, values);
    }
    await client.query('COMMIT');
    logger.info('Inserted category hierarchy', { count: hierarchies.length });
  } catch (error) {
    await client.query('ROLLBACK');
    const err = error as Error;
    logger.error('Failed to insert category hierarchy', { error: err.message });
    throw error;
  } finally {
    client.release();
  }
}

export async function insertImagesStaging(images: ImageRecord[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      INSERT INTO images_staging (product_code, image_url, image_name, imported_at)
      VALUES ($1, $2, $3, $4)
    `;
    for (const img of images) {
      const values = [img.PRODUCT_CODE, img.IMAGE_URL, img.IMAGE_NAME, new Date()];
      await client.query(query, values);
    }
    await client.query('COMMIT');
    logger.info('Inserted images into staging', { count: images.length });
  } catch (error) {
    await client.query('ROLLBACK');
    const err = error as Error;
    logger.error('Failed to insert images staging', { error: err.message });
    throw error;
  } finally {
    client.release();
  }
}