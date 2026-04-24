import { pool } from '../config/database';
import { ValidatedProduct } from '../validation/product-validator';
import { logger } from '../logger';

export async function promoteToProduction(validatedProducts: ValidatedProduct[]): Promise<void> {
  // MVP: Limit to 10 products
  const productsToPromote = validatedProducts.slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear old production data or update based on changes
    // For simplicity, insert/update valid products
    const query = `
      INSERT INTO products (
        product_code, name_en, name_fi, name_sv, brand, category_codes,
        price_eur_excl_vat, price_eur_incl_vat, stock_total, stock_vaasa, stock_sweden,
        barcode, vendor_name, catalog_restriction, image_url, imported_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (product_code) DO UPDATE SET
        name_en = EXCLUDED.name_en,
        name_fi = EXCLUDED.name_fi,
        name_sv = EXCLUDED.name_sv,
        brand = EXCLUDED.brand,
        category_codes = EXCLUDED.category_codes,
        price_eur_excl_vat = EXCLUDED.price_eur_excl_vat,
        price_eur_incl_vat = EXCLUDED.price_eur_incl_vat,
        stock_total = EXCLUDED.stock_total,
        stock_vaasa = EXCLUDED.stock_vaasa,
        stock_sweden = EXCLUDED.stock_sweden,
        barcode = EXCLUDED.barcode,
        vendor_name = EXCLUDED.vendor_name,
        catalog_restriction = EXCLUDED.catalog_restriction,
        image_url = EXCLUDED.image_url,
        imported_at = EXCLUDED.imported_at,
        status = EXCLUDED.status
    `;

    for (const product of productsToPromote) {
      const status = product.errors.length === 0 ? 'valid' : 'invalid';
      const values = [
        product.product_code,
        product.name_en,
        product.name_fi,
        product.name_sv,
        product.brand,
        product.category_codes,
        product.price_eur_excl_vat,
        product.price_eur_incl_vat,
        product.stock_total,
        product.stock_vaasa,
        product.stock_sweden,
        product.barcode,
        product.vendor_name,
        product.catalog_restriction,
        product.image_url,
        new Date(),
        status
      ];
      await client.query(query, values);
    }

    await client.query('COMMIT');
    logger.info('Promoted products to production', { count: productsToPromote.length });
  } catch (error) {
    await client.query('ROLLBACK');
    const err = error as Error;
    logger.error('Failed to promote to production', { error: err.message });
    throw error;
  } finally {
    client.release();
  }
}