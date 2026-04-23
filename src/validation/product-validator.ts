import { ProductRecord, PriceRecord, StockRecord } from '../parsers/csv-parser';
import { logger } from '../logger';

export interface ValidationError {
  field: string;
  value: any;
  reason: string;
}

export interface ValidatedProduct {
  product_code: string;
  name_en?: string;
  name_fi?: string;
  name_sv?: string;
  brand?: string;
  category_codes?: string[];
  price_eur_excl_vat?: number;
  price_eur_incl_vat?: number;
  stock_total?: number;
  stock_vaasa?: number;
  stock_sweden?: number;
  barcode?: string;
  vendor_name?: string;
  catalog_restriction?: string;
  image_url?: string;
  errors: ValidationError[];
}

export class ProductValidator {
  validateProduct(record: ProductRecord): { isValid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    // Required: product_code
    if (!record.product_code || record.product_code.trim() === '') {
      errors.push({ field: 'product_code', value: record.product_code, reason: 'Product code is required and cannot be empty' });
    }

    // At least one name
    if (!record.product_name_en && !record.product_name_fi && !record.product_name_sv) {
      errors.push({ field: 'product_name', value: null, reason: 'At least one product name (en/fi/sv) is required' });
    }

    // Brand is optional but if present, not empty
    if (record.brand && record.brand.trim() === '') {
      errors.push({ field: 'brand', value: record.brand, reason: 'Brand cannot be empty if provided' });
    }

    // Categories: parse comma-separated, validate each exists (but we don't have category list yet, so just check format)
    if (record.categories) {
      const codes = record.categories.split(',').map(c => c.trim()).filter(c => c);
      if (codes.length === 0) {
        errors.push({ field: 'categories', value: record.categories, reason: 'Categories must be comma-separated non-empty values' });
      }
    }

    // Barcode: optional, but if present, basic format check
    if (record.barcode && !/^\d+$/.test(record.barcode)) {
      errors.push({ field: 'barcode', value: record.barcode, reason: 'Barcode must be numeric' });
    }

    // Vendor name: optional
    // Catalog restriction: optional

    // Check for SQL injection in text fields (basic check)
    const textFields = ['product_name_en', 'product_name_fi', 'product_name_sv', 'brand', 'vendor_name', 'short_description_en', 'long_description_en'];
    for (const field of textFields) {
      const value = record[field];
      if (value && (value.includes(';') || value.includes('--') || value.toLowerCase().includes('drop') || value.toLowerCase().includes('select'))) {
        errors.push({ field, value, reason: 'Potential SQL injection detected' });
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  validatePrice(record: PriceRecord): { isValid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    if (!record.PRODUCT_CODE || record.PRODUCT_CODE.trim() === '') {
      errors.push({ field: 'PRODUCT_CODE', value: record.PRODUCT_CODE, reason: 'Product code is required' });
    }

    // Prices should be non-negative numbers
    const priceFields = ['EUR_EXCL_VAT', 'EUR_INCL_VAT', 'EUR_EXCL_VAT_EU', 'EUR_INCL_VAT_EU', 'SEK_EXCL_VAT', 'SEK_INCL_VAT', 'NOK_EXCL_VAT', 'NOK_INCL_VAT', 'GBP_EXCL_VAT', 'DKK_EXCL_VAT', 'DKK_INCL_VAT'];
    for (const field of priceFields) {
      const value = record[field];
      if (value !== undefined && value !== '') {
        const num = parseFloat(value);
        if (isNaN(num) || num < 0) {
          errors.push({ field, value, reason: 'Price must be a non-negative number' });
        }
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  validateStock(record: StockRecord, source: 'product_code' | 'ean'): { isValid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    const keyField = source === 'product_code' ? 'PRODUCT_CODE' : 'EAN';
    if (!record[keyField] || record[keyField].trim() === '') {
      errors.push({ field: keyField, value: record[keyField], reason: `${keyField} is required` });
    }

    // Stock levels should be non-negative integers
    const stockFields = ['VAASA', 'SWEDEN', 'TOTAL'];
    for (const field of stockFields) {
      const value = record[field];
      if (value !== undefined && value !== '') {
        const num = parseInt(value, 10);
        if (isNaN(num) || num < 0) {
          errors.push({ field, value, reason: 'Stock must be a non-negative integer' });
        }
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  enrichProduct(
    product: ProductRecord,
    price?: PriceRecord,
    stock?: StockRecord,
    image?: { IMAGE_URL: string }
  ): ValidatedProduct {
    const { isValid, errors } = this.validateProduct(product);

    const validated: ValidatedProduct = {
      product_code: product.product_code,
      name_en: product.product_name_en,
      name_fi: product.product_name_fi,
      name_sv: product.product_name_sv,
      brand: product.brand,
      category_codes: product.categories ? product.categories.split(',').map(c => c.trim()).filter(c => c) : undefined,
      barcode: product.barcode,
      vendor_name: product.vendor_name,
      catalog_restriction: product.catalog_restriction,
      errors,
    };

    // Add price if available and valid
    if (price) {
      const priceValidation = this.validatePrice(price);
      if (priceValidation.isValid) {
        validated.price_eur_excl_vat = parseFloat(price.EUR_EXCL_VAT || '0');
        validated.price_eur_incl_vat = parseFloat(price.EUR_INCL_VAT || '0');
      } else {
        errors.push(...priceValidation.errors.map(e => ({ ...e, field: `price.${e.field}` })));
      }
    }

    // Add stock if available and valid
    if (stock) {
      const stockValidation = this.validateStock(stock, stock.PRODUCT_CODE ? 'product_code' : 'ean');
      if (stockValidation.isValid) {
        validated.stock_vaasa = parseInt(stock.VAASA || '0', 10);
        validated.stock_sweden = parseInt(stock.SWEDEN || '0', 10);
        validated.stock_total = parseInt(stock.TOTAL || '0', 10);
      } else {
        errors.push(...stockValidation.errors.map(e => ({ ...e, field: `stock.${e.field}` })));
      }
    }

    // Add image if available
    if (image) {
      validated.image_url = image.IMAGE_URL;
    }

    return validated;
  }
}