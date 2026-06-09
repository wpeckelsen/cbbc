import fs from 'fs';
import csv from 'csv-parser';
import { Logger } from 'pino';
import { logger as defaultLogger } from '../logger';

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

export async function parseProductsCsv(filePath: string, log: Logger = defaultLogger): Promise<ProductRecord[]> {
  const results: ProductRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        log.info(`Parsed products CSV (${results.length} rows)`);
        resolve(results);
      })
      .on('error', (error) => {
        log.error({ filePath, error: error.message }, 'Failed to parse products CSV');
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

export async function parsePricesCsv(filePath: string, log: Logger = defaultLogger): Promise<PriceRecord[]> {
  const results: PriceRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        log.info(`Parsed prices CSV (${results.length} rows)`);
        resolve(results);
      })
      .on('error', (error) => {
        log.error({ filePath, error: error.message }, 'Failed to parse prices CSV');
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

export async function parseStockCsv(filePath: string, source: 'product_code' | 'ean', log: Logger = defaultLogger): Promise<StockRecord[]> {
  const results: StockRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        log.info(`Parsed stock CSV [${source}] (${results.length} rows)`);
        resolve(results);
      })
      .on('error', (error) => {
        log.error({ filePath, source, error: error.message }, 'Failed to parse stock CSV');
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

export async function parseCategoriesCsv(filePath: string, log: Logger = defaultLogger): Promise<CategoryRecord[]> {
  const results: CategoryRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        log.info(`Parsed categories CSV (${results.length} rows)`);
        resolve(results);
      })
      .on('error', (error) => {
        log.error({ filePath, error: error.message }, 'Failed to parse categories CSV');
        reject(error);
      });
  });
}

export interface CategoryHierarchyRecord {
  GROUP_ID: string;
  PREV_GROUP: string;
  GROUP_LEVEL: string;
}

export async function parseCategoryHierarchyCsv(filePath: string, log: Logger = defaultLogger): Promise<CategoryHierarchyRecord[]> {
  const results: CategoryHierarchyRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        log.info(`Parsed category hierarchy CSV (${results.length} rows)`);
        resolve(results);
      })
      .on('error', (error) => {
        log.error({ filePath, error: error.message }, 'Failed to parse category hierarchy CSV');
        reject(error);
      });
  });
}

export interface ImageRecord {
  PRODUCT_CODE: string;
  IMAGE_URL: string;
  IMAGE_NAME: string;
}

export async function parseImagesCsv(filePath: string, log: Logger = defaultLogger): Promise<ImageRecord[]> {
  const results: ImageRecord[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (data: any) => results.push(data))
      .on('end', () => {
        log.info(`Parsed images CSV (${results.length} rows)`);
        resolve(results);
      })
      .on('error', (error) => {
        log.error({ filePath, error: error.message }, 'Failed to parse images CSV');
        reject(error);
      });
  });
}
