import { ProductRecord, PriceRecord, StockRecord } from '../parsers/csv-parser';

export interface ValidationError {
  field: string;
  value: any;
  reason: string;
}

export interface ValidatedProduct {
  product_code: string;
  parent?: string;
  model_code?: string;
  product_model_name_en?: string;
  product_model_name_fi?: string;
  product_model_name_sv?: string;
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

    // Required: name_en
    if (!record.product_name_en || record.product_name_en.trim() === '') {
      errors.push({ field: 'name_en', value: record.product_name_en, reason: 'name_en is required and cannot be empty' });
    }

    // Optional: other names (if present, non-empty)
    if (record.product_name_fi !== undefined && record.product_name_fi !== null && record.product_name_fi.trim() === '') {
      errors.push({ field: 'name_fi', value: record.product_name_fi, reason: 'name_fi cannot be empty if provided' });
    }
    if (record.product_name_sv !== undefined && record.product_name_sv !== null && record.product_name_sv.trim() === '') {
      errors.push({ field: 'name_sv', value: record.product_name_sv, reason: 'name_sv cannot be empty if provided' });
    }

    // Required: brand
    if (!record.brand || record.brand.trim() === '') {
      errors.push({ field: 'brand', value: record.brand, reason: 'brand is required and cannot be empty' });
    }

    // Required: vendor_name
    if (!record.vendor_name || record.vendor_name.trim() === '') {
      errors.push({ field: 'vendor_name', value: record.vendor_name, reason: 'vendor_name is required and cannot be empty' });
    }

    // Required: category_codes (from categories csv column)
    if (!record.categories || record.categories.trim() === '') {
      errors.push({ field: 'category_codes', value: record.categories, reason: 'category_codes is required' });
    } else {
      const codes = record.categories.split(',').map(c => c.trim()).filter(c => c);
      if (codes.length === 0) {
        errors.push({ field: 'category_codes', value: record.categories, reason: 'category_codes must contain at least one non-empty code' });
      }
    }

    // Required: barcode (numeric)
    if (!record.barcode || record.barcode.trim() === '') {
      errors.push({ field: 'barcode', value: record.barcode, reason: 'barcode is required and cannot be empty' });
    } else if (!/^\d+$/.test(record.barcode.trim())) {
      errors.push({ field: 'barcode', value: record.barcode, reason: 'barcode must be numeric' });
    }

    // Catalog restriction: optional (no strict semantics yet)

    return { isValid: errors.length === 0, errors };
  }

  validatePrice(record: PriceRecord): { isValid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    if (!record.PRODUCT_CODE || record.PRODUCT_CODE.trim() === '') {
      errors.push({ field: 'PRODUCT_CODE', value: record.PRODUCT_CODE, reason: 'Product code is required' });
    }

    // Required: EUR prices (strict)
    const exclRaw = record.EUR_EXCL_VAT;
    const inclRaw = record.EUR_INCL_VAT;

    if (exclRaw === undefined || exclRaw === null || String(exclRaw).trim() === '') {
      errors.push({ field: 'EUR_EXCL_VAT', value: exclRaw, reason: 'EUR_EXCL_VAT is required' });
    }
    if (inclRaw === undefined || inclRaw === null || String(inclRaw).trim() === '') {
      errors.push({ field: 'EUR_INCL_VAT', value: inclRaw, reason: 'EUR_INCL_VAT is required' });
    }

    const excl = exclRaw !== undefined && exclRaw !== null && String(exclRaw).trim() !== '' ? parseFloat(String(exclRaw)) : NaN;
    const incl = inclRaw !== undefined && inclRaw !== null && String(inclRaw).trim() !== '' ? parseFloat(String(inclRaw)) : NaN;

    if (!isNaN(excl) && excl < 0) {
      errors.push({ field: 'EUR_EXCL_VAT', value: exclRaw, reason: 'Price must be a non-negative number' });
    }
    if (!isNaN(incl) && incl < 0) {
      errors.push({ field: 'EUR_INCL_VAT', value: inclRaw, reason: 'Price must be a non-negative number' });
    }
    if (!isNaN(excl) && !isNaN(incl) && incl < excl) {
      errors.push({ field: 'EUR_INCL_VAT', value: inclRaw, reason: 'EUR_INCL_VAT must be greater than or equal to EUR_EXCL_VAT' });
    }

    // Other price fields (if present) must be non-negative numbers
    const otherPriceFields = ['EUR_EXCL_VAT_EU', 'EUR_INCL_VAT_EU', 'SEK_EXCL_VAT', 'SEK_INCL_VAT', 'NOK_EXCL_VAT', 'NOK_INCL_VAT', 'GBP_EXCL_VAT', 'DKK_EXCL_VAT', 'DKK_INCL_VAT'];
    for (const field of otherPriceFields) {
      const value = record[field];
      if (value !== undefined && value !== '') {
        const num = parseFloat(String(value));
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

    // Required: TOTAL stock
    if (record.TOTAL === undefined || record.TOTAL === null || String(record.TOTAL).trim() === '') {
      errors.push({ field: 'TOTAL', value: record.TOTAL, reason: 'TOTAL stock is required' });
    }

    // Stock levels should be non-negative integers
    const stockFields = ['VAASA', 'SWEDEN', 'TOTAL'];
    for (const field of stockFields) {
      const value = record[field];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        const num = parseInt(String(value), 10);
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
    const { errors } = this.validateProduct(product);

    const parent = typeof product.parent === 'string' && product.parent.trim() !== '' ? product.parent.trim() : undefined;
    const model_code = parent ?? product.product_code;

    const validated: ValidatedProduct = {
      product_code: product.product_code,
      parent,
      model_code,
      product_model_name_en: product.product_model_name_en,
      product_model_name_fi: product.product_model_name_fi,
      product_model_name_sv: product.product_model_name_sv,
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

    // Price is required
    if (!price) {
      errors.push({ field: 'price_eur', value: null, reason: 'EUR price is required' });
    } else {
      const priceValidation = this.validatePrice(price);
      if (priceValidation.isValid) {
        validated.price_eur_excl_vat = parseFloat(String(price.EUR_EXCL_VAT));
        validated.price_eur_incl_vat = parseFloat(String(price.EUR_INCL_VAT));
      } else {
        errors.push(...priceValidation.errors.map(e => ({ ...e, field: `price.${e.field}` })));
      }
    }

    // Stock is required
    if (!stock) {
      errors.push({ field: 'stock_total', value: null, reason: 'stock_total is required' });
    } else {
      const stockValidation = this.validateStock(stock, 'product_code');
      if (stockValidation.isValid) {
        if (stock.VAASA !== undefined && stock.VAASA !== null && String(stock.VAASA).trim() !== '') {
          validated.stock_vaasa = parseInt(String(stock.VAASA), 10);
        }
        if (stock.SWEDEN !== undefined && stock.SWEDEN !== null && String(stock.SWEDEN).trim() !== '') {
          validated.stock_sweden = parseInt(String(stock.SWEDEN), 10);
        }
        validated.stock_total = parseInt(String(stock.TOTAL), 10);
      } else {
        errors.push(...stockValidation.errors.map(e => ({ ...e, field: `stock.${e.field}` })));
      }
    }

    // Image URL is required and must be http(s)
    const imageUrl = image?.IMAGE_URL;
    if (!imageUrl || String(imageUrl).trim() === '') {
      errors.push({ field: 'image_url', value: imageUrl, reason: 'image_url is required' });
    } else if (!/^https?:\/\//i.test(String(imageUrl).trim())) {
      errors.push({ field: 'image_url', value: imageUrl, reason: 'image_url must start with http:// or https://' });
    } else {
      validated.image_url = String(imageUrl).trim();
    }

    return validated;
  }
}