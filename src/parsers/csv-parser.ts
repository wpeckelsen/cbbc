import fs from 'fs';
import csv from 'csv-parser';
import { logger } from '../logger';

export interface ProductRecord {
  product_code: string;
  categories?: string;
  family?: string;
  parent?: string;
  one_variant?: string;
  customs_pos?: string;
  product_model_name_en?: string;
  product_model_name_fi?: string;
  product_model_name_sv?: string;
  vendor_name?: string;
  country_origin?: string;
  vak_code?: string;
  yk_no?: string;
  supplier_product_code?: string;
  catalog_restriction?: string;
  material?: string;
  make_model?: string;
  brand?: string;
  short_description_en?: string;
  short_description_fi?: string;
  short_description_sv?: string;
  long_description_en?: string;
  long_description_fi?: string;
  long_description_sv?: string;
  product_name_en?: string;
  product_name_fi?: string;
  product_name_sv?: string;
  barcode?: string;
  // ... other fields as needed, but for brevity, we'll parse all
  [key: string]: any;
}

export async function parseProductsCsv(filePath: string): Promise<ProductRecord[]> {
  const results: ProductRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        logger.info('Parsed products CSV', { count: results.length });
        resolve(results);
      })
      .on('error', (error) => {
        logger.error('Failed to parse products CSV', { filePath, error: error.message });
        reject(error);
      });
  });
}

export interface PriceRecord {
  PRODUCT_CODE: string;
  EUR_EXCL_VAT?: string;
  EUR_INCL_VAT?: string;
  EUR_EXCL_VAT_EU?: string;
  EUR_INCL_VAT_EU?: string;
  SEK_EXCL_VAT?: string;
  SEK_INCL_VAT?: string;
  NOK_EXCL_VAT?: string;
  NOK_INCL_VAT?: string;
  GBP_EXCL_VAT?: string;
  DKK_EXCL_VAT?: string;
  DKK_INCL_VAT?: string;
  [key: string]: any;
}

export async function parsePricesCsv(filePath: string): Promise<PriceRecord[]> {
  const results: PriceRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        logger.info('Parsed prices CSV', { count: results.length });
        resolve(results);
      })
      .on('error', (error) => {
        logger.error('Failed to parse prices CSV', { filePath, error: error.message });
        reject(error);
      });
  });
}

export interface StockRecord {
  PRODUCT_CODE?: string;
  EAN?: string;
  VAASA?: string;
  SWEDEN?: string;
  TOTAL?: string;
  [key: string]: any;
}

export async function parseStockCsv(filePath: string, source: 'product_code' | 'ean'): Promise<StockRecord[]> {
  const results: StockRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        logger.info('Parsed stock CSV', { source, count: results.length });
        resolve(results);
      })
      .on('error', (error) => {
        logger.error('Failed to parse stock CSV', { filePath, source, error: error.message });
        reject(error);
      });
  });
}

export interface CategoryRecord {
  ID: string;
  CODE: string;
  DESCRIPTION: string;
  LANGUAGE_NUMBER: string;
}

export async function parseCategoriesCsv(filePath: string): Promise<CategoryRecord[]> {
  const results: CategoryRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        logger.info('Parsed categories CSV', { count: results.length });
        resolve(results);
      })
      .on('error', (error) => {
        logger.error('Failed to parse categories CSV', { filePath, error: error.message });
        reject(error);
      });
  });
}

export interface CategoryHierarchyRecord {
  ID: string;
  PREV_CATEGORY: string;
  CATEGORY_LEVEL: string;
}

export async function parseCategoryHierarchyCsv(filePath: string): Promise<CategoryHierarchyRecord[]> {
  const results: CategoryHierarchyRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        logger.info('Parsed category hierarchy CSV', { count: results.length });
        resolve(results);
      })
      .on('error', (error) => {
        logger.error('Failed to parse category hierarchy CSV', { filePath, error: error.message });
        reject(error);
      });
  });
}

export interface ImageRecord {
  PRODUCT_CODE: string;
  IMAGE_URL: string;
  IMAGE_NAME: string;
}

export async function parseImagesCsv(filePath: string): Promise<ImageRecord[]> {
  const results: ImageRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        logger.info('Parsed images CSV', { count: results.length });
        resolve(results);
      })
      .on('error', (error) => {
        logger.error('Failed to parse images CSV', { filePath, error: error.message });
        reject(error);
      });
  });
}