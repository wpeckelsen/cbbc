import { Logger } from 'pino';
import { DatabaseClient, databaseClient as defaultDatabaseClient } from './db-client';
import { ValidatedProduct } from '../validation/product-validator';
import { logger as defaultLogger } from '../logger';
import { logBoundarySample } from '../utils/pipeline-debug';

/** Fixed EUR → DKK conversion rate. */
const EUR_TO_DKK = 7.47417;

// Module-level logger + database client, configurable per pipeline run.
let log: Logger = defaultLogger;
let dbClient: DatabaseClient = defaultDatabaseClient;

/**
 * Configure module-level logger and (optionally) database client for the
 * current pipeline run. Call this once at the start of a run; reset is
 * automatic at process exit or can be done manually.
 */
export function configureProductsApi(logger: Logger, client?: DatabaseClient): void {
  log = logger;
  if (client) dbClient = client;
}

function toNullableNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s === '') return null;
  const normalized = s.replace(',', '.');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeCategoryCodes(value: any): string[] {
  if (!Array.isArray(value)) return [];
  const out = value
    .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
    .filter((v) => v !== '');
  out.sort((a, b) => a.localeCompare(b));
  return Array.from(new Set(out));
}

function deriveModelCode(p: ValidatedProduct): string {
  const raw = typeof p.model_code === 'string' && p.model_code.trim() !== '' ? p.model_code.trim() : undefined;
  return raw ?? p.product_code;
}

type ProductModelRow = {
  model_code: string;
  name_en: string;
  name_fi: string | null;
  name_sv: string | null;
  brand: string;
  vendor_name: string;
  category_codes: string[];
  catalog_restriction: string | null;
  short_description_en: string | null;
  imported_at: string;
  last_synced_at?: string | null;
};

type ProductVariantRow = {
  product_code: string;
  model_code: string;
  name_en: string;
  barcode: string;
  price_eur_excl_vat: number;
  price_eur_incl_vat: number;
  price_dkk_excl_vat: number;
  stock_total: number;
  stock_vaasa: number | null;
  stock_sweden: number | null;
  image_urls: string[];
  imported_at: string;
  last_synced_at?: string | null;
};

type ModelMetadata = Partial<
  Pick<
    ValidatedProduct,
    | 'product_model_name_en'
    | 'product_model_name_fi'
    | 'product_model_name_sv'
    | 'name_en'
    | 'name_fi'
    | 'name_sv'
    | 'brand'
    | 'vendor_name'
    | 'category_codes'
    | 'catalog_restriction'
  >
> & { short_description_en?: string | null };

const PRODUCTS_STAGING_COLUMNS = [
  'product_code',
  'categories',
  'family',
  'parent',
  'customs_pos',
  'product_model_name_en',
  'product_model_name_fi',
  'product_model_name_sv',
  'vendor_name',
  'country_origin',
  'vak_code',
  'yk_no',
  'supplier_product_code',
  'catalog_restriction',
  'material',
  'make_model',
  'brand',
  'short_description_en',
  'short_description_fi',
  'short_description_sv',
  'long_description_en',
  'long_description_fi',
  'long_description_sv',
  'product_name_en',
  'product_name_fi',
  'product_name_sv',
  'barcode',
  'compound',
  'lug_height',
  'lug_height_unit',
  'oem_number',
  'tyre_studs',
  'tyre_ply_rating',
  'waterproof',
  'foldable',
  'bolt_pattern',
  'top_hole_diameter',
  'top_hole_diameter_unit',
  'top_eyelet_width',
  'top_eyelet_width_unit',
  'bottom_hole_diameter',
  'bottom_hole_diameter_unit',
  'bottom_eyelet_width',
  'bottom_eyelet_width_unit',
  'construction',
  'intercom_range',
  'bulb_base',
  'resistor',
  'handlebar_clamp_diameter',
  'handlebar_clamp_diameter_unit',
  'front_rear_tyre',
  'mounting_kit_included',
  'winch_max_capacity',
  'winch_max_capacity_unit',
  'tyre_weight_index',
  'tyre_speed_rating',
  'power_light',
  'power_light_unit',
  'helmet_safety_system',
  'studs_count',
  'valve_type',
  'valve_length',
  'valve_length_unit',
  'bicycle_brake_type',
  'handlebar_rise',
  'handlebar_rise_unit',
  'buoyancy',
  'buoyancy_unit',
  'bicycle_brake_model',
  'bicycle_wheel_hub',
  'clothing_size',
  'gender',
  'has_membrane',
  'package_weight',
  'package_weight_unit',
  'package_height',
  'package_height_unit',
  'package_width',
  'package_width_unit',
  'package_length',
  'package_length_unit',
  'packing_size',
  'certifications',
  'size',
  'tyre_rim_size',
  'tyre_rim_size_unit',
  'tyre_height',
  'tyre_height_unit',
  'tyre_width',
  'tyre_width_unit',
  'max_load',
  'max_load_unit',
  'etrto_size',
  'track_length',
  'track_length_unit',
  'track_width',
  'track_width_unit',
  'track_pitch',
  'track_pitch_unit',
  'rim_width',
  'rim_width_unit',
  'cc_max',
  'cc_max_unit',
  'cc_min',
  'cc_min_unit',
  'spokes_length',
  'spokes_length_unit',
  'product_weight',
  'product_weight_unit',
  'product_height',
  'product_height_unit',
  'product_width',
  'product_width_unit',
  'product_length',
  'product_length_unit',
  'sparkplug_thread_length',
  'thickness',
  'thickness_unit',
  'diameter',
  'diameter_unit',
  'inner_diameter',
  'inner_diameter_unit',
  'outer_diameter',
  'outer_diameter_unit',
  'riser_height',
  'riser_height_unit',
  'oil_type',
  'oil_viscosity',
  'oil_volume',
  'oil_volume_unit',
  'oil_stroke',
  'sprocket_front',
  'sprocket_rear',
  'drive_chain_pitch',
  'chain_links',
  'sprocket_internal_splines',
  'chain_guard',
  'drive_chain_lock_type',
  'drive_chain_seal_type',
  'drive_pitch',
  'lens_colour',
  'touch_screen_compatible',
  'sparkplug_seat_configuration',
  'silencer_fitment',
  'teeth_count',
  'pre_drilled',
  'clamp_on',
  'sunvisor',
  'sparkplug_heat_rating',
  'volume',
  'volume_unit',
  'colour_en',
  'colour_fi',
  'colour_sv',
  'colour_property_en',
  'colour_property_fi',
  'colour_property_sv',
  'derailleur_gears_speed',
  'bag_type',
  'lens_type',
  'battery_type',
  'filter_type',
  'track_type',
  'bulb_type',
  'transmission_type',
  'jet_type',
  'suspension',
  'riding_style',
  'adjustability_type',
  'helmet_type',
  'lever_type',
  'light_part_type',
  'silencer_type',
  'cable_type',
  'bearing_kit_type',
  'lifejacket_type',
  'battery_cca',
  'battery_cca_unit',
  'battery_capacity',
  'battery_capacity-unit',
  'category_codes',
  'created',
  'updated',
  'raw_hash',
  'imported_at',
  'image_url',
] as const;

type ProductsStagingColumn = (typeof PRODUCTS_STAGING_COLUMNS)[number];

export type ProductsStagingRow =
  & { product_code: string; imported_at: string }
  & Partial<Record<Exclude<ProductsStagingColumn, 'product_code' | 'imported_at'>, any>>;

const PRODUCTS_STAGING_COLUMN_SET = new Set<string>(PRODUCTS_STAGING_COLUMNS);

function sanitizeStagingValue(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return String(value).trim();
}

// Helper function to transform keys from FTP format to DB format
function transformProductKeys(product: Record<string, any>): Record<string, any> {
    const mapping: Record<string, string> = {
        // Explicit mappings for case and hyphen differences
        'product_model_name-en': 'product_model_name_en',
        'product_model_name-fi': 'product_model_name_fi',
        'product_model_name-sv': 'product_model_name_sv',
        'short_description-en': 'short_description_en',
        'short_description-fi': 'short_description_fi',
        'short_description-sv': 'short_description_sv',
        'long_description-en': 'long_description_en',
        'long_description-fi': 'long_description_fi',
        'long_description-sv': 'long_description_sv',
        'product_name-en': 'product_name_en',
        'product_name-fi': 'product_name_fi',
        'product_name-sv': 'product_name_sv',
        'lug_height-unit': 'lug_height_unit',
        'top_hole_diameter-unit': 'top_hole_diameter_unit',
        'top_eyelet_width-unit': 'top_eyelet_width_unit',
        'bottom_hole_diameter-unit': 'bottom_hole_diameter_unit',
        'bottom_eyelet_width-unit': 'bottom_eyelet_width_unit',
        'handlebar_clamp_diameter-unit': 'handlebar_clamp_diameter_unit',
        'winch_max_capacity-unit': 'winch_max_capacity_unit',
        'power_light-unit': 'power_light_unit',
        'valve_length-unit': 'valve_length_unit',
        'handlebar_rise-unit': 'handlebar_rise_unit',
        'buoyancy-unit': 'buoyancy_unit',
        'package_weight-unit': 'package_weight_unit',
        'package_height-unit': 'package_height_unit',
        'package_width-unit': 'package_width_unit',
        'package_length-unit': 'package_length_unit',
        'tyre_rim_size-unit': 'tyre_rim_size_unit',
        'tyre_height-unit': 'tyre_height_unit',
        'tyre_width-unit': 'tyre_width_unit',
        'max_load-unit': 'max_load_unit',
        'track_length-unit': 'track_length_unit',
        'track_width-unit': 'track_width_unit',
        'track_pitch-unit': 'track_pitch_unit',
        'rim_width-unit': 'rim_width_unit',
        'cc_max-unit': 'cc_max_unit',
        'cc_min-unit': 'cc_min_unit',
        'spokes_length-unit': 'spokes_length_unit',
        'product_weight-unit': 'product_weight_unit',
        'product_height-unit': 'product_height_unit',
        'product_width-unit': 'product_width_unit',
        'product_length-unit': 'product_length_unit',
        'thickness-unit': 'thickness_unit',
        'diameter-unit': 'diameter_unit',
        'inner_diameter-unit': 'inner_diameter_unit',
        'outer_diameter-unit': 'outer_diameter_unit',
        'riser_height-unit': 'riser_height_unit',
        'oil_volume-unit': 'oil_volume_unit',
        'volume-unit': 'volume_unit',
        'colour-en': 'colour_en',
        'colour-fi': 'colour_fi',
        'colour-sv': 'colour_sv',
        'colour_property-en': 'colour_property_en',
        'colour_property-fi': 'colour_property_fi',
        'colour_property-sv': 'colour_property_sv',
        'battery_cca-unit': 'battery_cca_unit',
        'battery_capacity-unit': '"battery_capacity-unit"', // Special case for schema
        'created': 'created',
        'updated': 'updated',

        // Uppercase to lowercase and hyphen to underscore
        'IMAGE_URL': 'image_url',
        'PRODUCT_CODE': 'product_code',
        'CATEGORIES': 'categories', // This will be mapped to 'categories' TEXT column in staging
        'FAMILY': 'family',
        'PARENT': 'parent',
        'ONE_VARIANT': 'one_variant',
        'CUSTOMS_POS': 'customs_pos',
        'VENDOR_NAME': 'vendor_name',
        'COUNTRY_ORIGIN': 'country_origin',
        'VAK_CODE': 'vak_code',
        'YK_NO': 'yk_no',
        'SUPPLIER_PRODUCT_CODE': 'supplier_product_code',
        'CATALOG_RESTRICTION': 'catalog_restriction',
        'MATERIAL': 'material',
        'MAKE_MODEL': 'make_model',
        'BRAND': 'brand',
        'BARCODE': 'barcode',
        'COMPOUND': 'compound',
        'LUG_HEIGHT': 'lug_height',
        'OEM_NUMBER': 'oem_number',
        'TYRE_STUDS': 'tyre_studs',
        'TYRE_PLY_RATING': 'tyre_ply_rating',
        'WATERPROOF': 'waterproof',
        'FOLDABLE': 'foldable',
        'BOLT_PATTERN': 'bolt_pattern',
        'TOP_HOLE_DIAMETER': 'top_hole_diameter',
        'TOP_EYELET_WIDTH': 'top_eyelet_width',
        'BOTTOM_HOLE_DIAMETER': 'bottom_hole_diameter',
        'BOTTOM_EYELET_WIDTH': 'bottom_eyelet_width',
        'CONSTRUCTION': 'construction',
        'INTERCOM_RANGE': 'intercom_range',
        'BULB_BASE': 'bulb_base',
        'RESISTOR': 'resistor',
        'HANDLEBAR_CLAMP_DIAMETER': 'handlebar_clamp_diameter',
        'FRONT_REAR_TYRE': 'front_rear_tyre',
        'MOUNTING_KIT_INCLUDED': 'mounting_kit_included',
        'WINCH_MAX_CAPACITY': 'winch_max_capacity',
        'TYRE_WEIGHT_INDEX': 'tyre_weight_index',
        'TYRE_SPEED_RATING': 'tyre_speed_rating',
        'POWER_LIGHT': 'power_light',
        'HELMET_SAFETY_SYSTEM': 'helmet_safety_system',
        'STUDS_COUNT': 'studs_count',
        'VALVE_TYPE': 'valve_type',
        'VALVE_LENGTH': 'valve_length',
        'BICYCLE_BRAKE_TYPE': 'bicycle_brake_type',
        'HANDLEBAR_RISE': 'handlebar_rise',
        'BUOYANCY': 'buoyancy',
        'BICYCLE_BRAKE_MODEL': 'bicycle_brake_model',
        'BICYCLE_WHEEL_HUB': 'bicycle_wheel_hub',
        'CLOTHING_SIZE': 'clothing_size',
        'GENDER': 'gender',
        'HAS_MEMBRANE': 'has_membrane',
        'PACKAGE_WEIGHT': 'package_weight',
        'PACKAGE_HEIGHT': 'package_height',
        'PACKAGE_WIDTH': 'package_width',
        'PACKAGE_LENGTH': 'package_length',
        'PACKING_SIZE': 'packing_size',
        'CERTIFICATIONS': 'certifications',
        'SIZE': 'size',
        'TYRE_RIM_SIZE': 'tyre_rim_size',
        'TYRE_HEIGHT': 'tyre_height',
        'TYRE_WIDTH': 'tyre_width',
        'MAX_LOAD': 'max_load',
        'ETRTO_SIZE': 'etrto_size',
        'TRACK_LENGTH': 'track_length',
        'TRACK_WIDTH': 'track_width',
        'TRACK_PITCH': 'track_pitch',
        'RIM_WIDTH': 'rim_width',
        'CC_MAX': 'cc_max',
        'CC_MIN': 'cc_min',
        'SPOKES_LENGTH': 'spokes_length',
        'PRODUCT_WEIGHT': 'product_weight',
        'PRODUCT_HEIGHT': 'product_height',
        'PRODUCT_WIDTH': 'product_width',
        'PRODUCT_LENGTH': 'product_length',
        'SPARKPLUG_THREAD_LENGTH': 'sparkplug_thread_length',
        'THICKNESS': 'thickness',
        'DIAMETER': 'diameter',
        'INNER_DIAMETER': 'inner_diameter',
        'OUTER_DIAMETER': 'outer_diameter',
        'RISER_HEIGHT': 'riser_height',
        'OIL_TYPE': 'oil_type',
        'OIL_VISCOSITY': 'oil_viscosity',
        'OIL_VOLUME': 'oil_volume',
        'OIL_STROKE': 'oil_stroke',
        'SPROCKET_FRONT': 'sprocket_front',
        'SPROCKET_REAR': 'sprocket_rear',
        'DRIVE_CHAIN_PITCH': 'drive_chain_pitch',
        'CHAIN_LINKS': 'chain_links',
        'SPROCKET_INTERNAL_SPLINES': 'sprocket_internal_splines',
        'CHAIN_GUARD': 'chain_guard',
        'DRIVE_CHAIN_LOCK_TYPE': 'drive_chain_lock_type',
        'DRIVE_CHAIN_SEAL_TYPE': 'drive_chain_seal_type',
        'DRIVE_PITCH': 'drive_pitch',
        'LENS_COLOUR': 'lens_colour',
        'TOUCH_SCREEN_COMPATIBLE': 'touch_screen_compatible',
        'SPARKPLUG_SEAT_CONFIGURATION': 'sparkplug_seat_configuration',
        'SILENCER_FITMENT': 'silencer_fitment',
        'TEETH_COUNT': 'teeth_count',
        'PRE_DRILLED': 'pre_drilled',
        'CLAMP_ON': 'clamp_on',
        'SUNVISOR': 'sunvisor',
        'SPARKPLUG_HEAT_RATING': 'sparkplug_heat_rating',
        'VOLUME': 'volume',
    };

    const transformedProduct: Record<string, any> = {};

    for (const key in product) {
        if (Object.prototype.hasOwnProperty.call(product, key)) {
            let dbKey = mapping[key];

            // If not explicitly mapped, try a general transformation
            if (!dbKey) {
                dbKey = key.toLowerCase().replace(/-/g, '_');
            }

            // Special handling for categories -> category_codes
            if (dbKey === 'categories') {
                const raw = sanitizeStagingValue(product[key]);
                if (typeof raw === 'string' && raw !== '') {
                  transformedProduct['categories'] = raw;
                  transformedProduct['category_codes'] = raw
                    .split(',')
                    .map((cat: string) => cat.trim())
                    .filter((cat: string) => cat !== '');
                } else {
                  transformedProduct['categories'] = null;
                }
            } else if (dbKey === 'created' || dbKey === 'updated') {
                // Ensure date fields are in ISO format if they exist and are valid
                if (product[key]) {
                    try {
                        const date = new Date(product[key]);
                        if (!isNaN(date.getTime())) {
                            transformedProduct[dbKey] = date.toISOString();
                        } else {
                            transformedProduct[dbKey] = null; // Or handle invalid date as needed
                        }
                    } catch (e) {
                        transformedProduct[dbKey] = null; // Handle potential parsing errors
                    }
                } else {
                    transformedProduct[dbKey] = null;
                }
            }
            else {
                transformedProduct[dbKey] = sanitizeStagingValue(product[key]);
            }
        }
    }

    // Add imported_at timestamp
    transformedProduct['imported_at'] = new Date().toISOString();

    return transformedProduct;
}

function toProductsStagingRow(product: Record<string, any>): ProductsStagingRow {
  const transformed = transformProductKeys(product);
  const filtered: Record<string, any> = {};

  for (const [k, v] of Object.entries(transformed)) {
    const key = k.replace(/^"|"$/g, '');
    if (PRODUCTS_STAGING_COLUMN_SET.has(key)) {
      filtered[key] = v;
    }
  }

  filtered['imported_at'] = new Date().toISOString();
  return filtered as ProductsStagingRow;
}

/**
 * Insert products into staging table (with batching for large datasets)
 */
export async function insertProductsStaging(products: any[]): Promise<void> {
  if (products.length === 0) {
    log.info('No products to insert into staging');
    return;
  }

  const BATCH_SIZE = 1000; // Process 1000 products at a time
  const batches = Math.ceil(products.length / BATCH_SIZE);

  try {
    log.info(`Inserting ${products.length} products into staging in ${batches} batches`);
    
    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, products.length);
      const batch = products.slice(start, end);
      
      const transformedBatch = batch.map((p) => toProductsStagingRow(p));

      logBoundarySample('pre-staging:products_staging', transformedBatch as any, undefined, log);
      
      await dbClient.upsert('products_staging', transformedBatch, 'product_code', {
        boundary: 'pipeline.pre-staging.products_staging',
      });
      log.info(`Batch ${i + 1}/${batches} complete (${batch.length} products)`);
    }
    
    log.info(`Successfully inserted ${products.length} products into staging`);
  } catch (error) {
    const err = error as Error;
    log.error('Failed to insert products into staging', { error: err.message });
    throw error;
  }
}

export async function clearStagingTablesForDev(): Promise<void> {
  await dbClient.deleteAllByNonNullColumn('products_staging', 'product_code');
  await dbClient.deleteAllByNonNullColumn('prices_staging', 'product_code');
  await dbClient.deleteAllByNonNullColumn('stock_staging', 'source');
  await dbClient.deleteAllByNonNullColumn('images_staging', 'product_code');
}

export async function clearProductionProductsForDev(): Promise<void> {
  await dbClient.deleteAllByNonNullColumn('product_variants', 'product_code');
  await dbClient.deleteAllByNonNullColumn('product_models', 'model_code');
}

/**
 * Insert prices into staging table (with batching for large datasets)
 */
export async function insertPricesStaging(prices: any[]): Promise<void> {
  if (prices.length === 0) {
    log.info('No prices to insert into staging');
    return;
  }

  const BATCH_SIZE = 1000;
  
  try {
    const formattedPrices = prices.map(price => ({
      product_code: price.PRODUCT_CODE,
      eur_excl_vat: toNullableNumber(price.EUR_EXCL_VAT),
      eur_incl_vat: toNullableNumber(price.EUR_INCL_VAT),
      eur_excl_vat_eu: toNullableNumber(price.EUR_EXCL_VAT_EU),
      eur_incl_vat_eu: toNullableNumber(price.EUR_INCL_VAT_EU),
      sek_excl_vat: toNullableNumber(price.SEK_EXCL_VAT),
      sek_incl_vat: toNullableNumber(price.SEK_INCL_VAT),
      nok_excl_vat: toNullableNumber(price.NOK_EXCL_VAT),
      nok_incl_vat: toNullableNumber(price.NOK_INCL_VAT),
      gbp_excl_vat: toNullableNumber(price.GBP_EXCL_VAT),
      dkk_excl_vat: toNullableNumber(price.DKK_EXCL_VAT),
      dkk_incl_vat: toNullableNumber(price.DKK_INCL_VAT),
      imported_at: new Date().toISOString(),
    }));

    const batches = Math.ceil(formattedPrices.length / BATCH_SIZE);
    log.info(`Inserting ${formattedPrices.length} prices into staging in ${batches} batches`);
    
    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, formattedPrices.length);
      const batch = formattedPrices.slice(start, end);
      
      logBoundarySample('pre-staging:prices_staging', batch as any, undefined, log);
      await dbClient.upsert('prices_staging', batch, 'product_code', {
        boundary: 'pipeline.pre-staging.prices_staging',
      });
      log.info(`Batch ${i + 1}/${batches} complete (${batch.length} prices)`);
    }
    
    log.info(`Successfully inserted ${formattedPrices.length} prices into staging`);
  } catch (error) {
    const err = error as Error;
    log.error('Failed to insert prices into staging', { error: err.message });
    throw error;
  }
}

/**
 * Insert stock data into staging table (with batching for large datasets)
 */
export async function insertStockStaging(stock: any[], source: string): Promise<void> {
  if (stock.length === 0) {
    log.info(`No stock data to insert into staging (source: ${source})`);
    return;
  }

  const BATCH_SIZE = 1000;
  
  try {
    const toInt = (value: any): number => {
      if (value === null || value === undefined || value === '') return 0;
      if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
      const s = String(value).trim();
      const head = s.split(/[,.]/, 1)[0];
      const n = Number.parseInt(head, 10);
      return Number.isFinite(n) ? n : 0;
    };

    const formattedStock = stock.map(item => ({
      product_code: item.PRODUCT_CODE || null,
      ean: item.EAN || null,
      vaasa: toInt(item.VAASA),
      sweden: toInt(item.SWEDEN),
      total: toInt(item.TOTAL),
      source: source,
      imported_at: new Date().toISOString(),
    }));

    const batches = Math.ceil(formattedStock.length / BATCH_SIZE);
    log.info(`Inserting ${formattedStock.length} stock records into staging in ${batches} batches (source: ${source})`);
    
    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, formattedStock.length);
      const batch = formattedStock.slice(start, end);
      
      logBoundarySample(`pre-staging:stock_staging:${source}`, batch as any, undefined, log);
      await dbClient.upsert('stock_staging', batch, 'product_code, source', {
        boundary: `pipeline.pre-staging.stock_staging:${source}`,
      });
      log.info(`Batch ${i + 1}/${batches} complete (${batch.length} stock records)`);
    }
    
    log.info(`Successfully inserted ${formattedStock.length} stock records into staging (source: ${source})`);
  } catch (error) {
    const err = error as Error;
    log.error('Failed to insert stock into staging', { error: err.message, source });
    throw error;
  }
}

/**
 * Insert categories
 */
export async function insertCategories(categories: any[]): Promise<void> {
  if (categories.length === 0) {
    log.info('No categories to insert');
    return;
  }

  try {
    // Deduplicate categories by ID, preferring language 2 (English) when available
    const byId = new Map<string, any[]>();
    for (const cat of categories) {
      const key = cat.ID;
      const arr = byId.get(key) || [];
      arr.push(cat);
      byId.set(key, arr);
    }

    const deduped = Array.from(byId.values()).map((list: any[]) => {
      const lang2 = list.find((c: any) => c.LANGUAGE_NUMBER === '2' || Number(c.LANGUAGE_NUMBER) === 2);
      const chosen = lang2 ?? list[0];
      return {
        id: chosen.ID,
        code: chosen.CODE,
        description: chosen.DESCRIPTION,
        language_number: parseInt(chosen.LANGUAGE_NUMBER) || 0,
      };
    });

    log.info(`Deduplicated categories: ${categories.length} -> ${deduped.length} (prefer English, lang 2)`);
    logBoundarySample('pre-staging:categories', deduped as any, undefined, log);
    await dbClient.upsert('categories', deduped, 'id', {
      boundary: 'pipeline.pre-staging.categories',
    });
    log.info(`Inserted ${deduped.length} categories`);
  } catch (error) {
    const err = error as Error;
    log.error('Failed to insert categories', { error: err.message });
    throw error;
  }
}

/**
 * Insert category hierarchy
 */
export async function insertCategoryHierarchy(hierarchy: any[]): Promise<void> {
  if (hierarchy.length === 0) {
    log.info('No category hierarchy to insert');
    return;
  }

  try {
    // Transform uppercase CSV keys to lowercase database keys
    const formattedHierarchy = hierarchy.map(h => ({
      id: h.GROUP_ID,
      prev_category: h.PREV_GROUP,
      category_level: parseInt(h.GROUP_LEVEL) || 0
    }));
    
    logBoundarySample('pre-staging:category_hierarchy', formattedHierarchy as any, undefined, log);
    await dbClient.upsert('category_hierarchy', formattedHierarchy, 'id', {
      boundary: 'pipeline.pre-staging.category_hierarchy',
    });
    log.info(`Inserted ${formattedHierarchy.length} category hierarchy records`);
  } catch (error) {
    const err = error as Error;
    log.error('Failed to insert category hierarchy', { error: err.message });
    throw error;
  }
}

/**
 * Insert images into staging table (with batching for large datasets)
 */
export async function insertImagesStaging(images: any[]): Promise<void> {
  if (images.length === 0) {
    log.info('No images to insert into staging');
    return;
  }

  const BATCH_SIZE = 1000;
  
  try {
    const formattedImages = images.map(image => ({
      product_code: image.PRODUCT_CODE,
      image_url: image.IMAGE_URL,
      image_name: image.IMAGE_NAME || null,
      imported_at: new Date().toISOString(),
    }));

    const batches = Math.ceil(formattedImages.length / BATCH_SIZE);
    log.info(`Inserting ${formattedImages.length} images into staging in ${batches} batches`);
    
    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, formattedImages.length);
      const batch = formattedImages.slice(start, end);
      
      logBoundarySample('pre-staging:images_staging', batch as any, undefined, log);
      await dbClient.insert('images_staging', batch, {
        boundary: 'pipeline.pre-staging.images_staging',
      });
      log.info(`Batch ${i + 1}/${batches} complete (${batch.length} images)`);
    }
    
    log.info(`Successfully inserted ${formattedImages.length} images into staging`);
  } catch (error) {
    const err = error as Error;
    log.error('Failed to insert images into staging', { error: err.message });
    throw error;
  }
}

/**
 * Promote validated products to production table (with batching for large datasets)
 */
export async function promoteToProduction(
  validatedProducts: ValidatedProduct[],
  opts?: {
    modelMetadataByCode?: Map<string, ModelMetadata>;
  }
): Promise<void> {
  if (validatedProducts.length === 0) {
    log.info('No products to promote to production');
    return;
  }

  const BATCH_SIZE = 1000;

  try {
    const rejected = validatedProducts.filter((p) => p.errors.length > 0);
    const accepted = validatedProducts.filter((p) => p.errors.length === 0);

    if (rejected.length > 0) {
      const byField: Record<string, number> = {};
      for (const p of rejected) {
        for (const e of p.errors) {
          byField[e.field] = (byField[e.field] || 0) + 1;
        }
      }
      const topFields = Object.entries(byField)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .reduce((acc, [k, v]) => {
          acc[k] = v;
          return acc;
        }, {} as Record<string, number>);

      log.warn(
        {
          rejected: rejected.length,
          accepted: accepted.length,
          topErrorFields: topFields,
        },
        'Rejected variants due to validation errors (not promoted to production)'
      );
    }

    if (accepted.length === 0) {
      log.info('No valid variants to promote to production');
      return;
    }

    const nowIso = new Date().toISOString();

    const variantsToPromote: ProductVariantRow[] = [];
    const modelRepresentative = new Map<string, ValidatedProduct>();

    for (const v of accepted) {
      const modelCode = deriveModelCode(v);
      if (!modelRepresentative.has(modelCode)) modelRepresentative.set(modelCode, v);

      const priceExcl = v.price_eur_excl_vat;
      const priceIncl = v.price_eur_incl_vat;
      const stockTotal = v.stock_total;

      const variantNameEn = typeof v.name_en === 'string' ? v.name_en.trim() : '';

      // Note: eligibility (name, barcode, image, price, stock) is now checked
      // upstream by isVariantEligible() in product-filter.ts before variants
      // reach promoteToProduction. The guard that previously lived here has
      // been removed to avoid maintaining two copies of the same logic.
      // The non-null assertions (!) below are safe because isVariantEligible
      // already confirmed these fields are present.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const priceDkkExcl = Math.round(priceExcl! * EUR_TO_DKK * 100) / 100;

      const imageUrls = Array.isArray(v.image_urls) && v.image_urls.length > 0
        ? v.image_urls
        : [];

      variantsToPromote.push({
        product_code: v.product_code,
        model_code: modelCode,
        name_en: variantNameEn,
        barcode: v.barcode!,
        price_eur_excl_vat: priceExcl!,
        price_eur_incl_vat: priceIncl!,
        price_dkk_excl_vat: priceDkkExcl,
        stock_total: stockTotal!,
        stock_vaasa: typeof v.stock_vaasa === 'number' ? v.stock_vaasa : null,
        stock_sweden: typeof v.stock_sweden === 'number' ? v.stock_sweden : null,
        image_urls: imageUrls,
        imported_at: nowIso,
      });
    }

    if (variantsToPromote.length === 0) {
      log.info('No variants with required fields to promote to production');
      return;
    }

    const modelsToPromote: ProductModelRow[] = [];
    for (const [modelCode, rep] of modelRepresentative) {
      const meta = opts?.modelMetadataByCode?.get(modelCode);

      const brandRaw = typeof meta?.brand === 'string' && meta.brand.trim() !== ''
        ? meta.brand
        : (typeof rep.brand === 'string' ? rep.brand : '');
      const vendorRaw = typeof meta?.vendor_name === 'string' && meta.vendor_name.trim() !== ''
        ? meta.vendor_name
        : (typeof rep.vendor_name === 'string' ? rep.vendor_name : '');

      const categoryCodes = Array.isArray(meta?.category_codes) && meta.category_codes.length > 0
        ? normalizeCategoryCodes(meta.category_codes)
        : normalizeCategoryCodes(rep.category_codes);

      const nameEn =
        (typeof meta?.product_model_name_en === 'string' && meta.product_model_name_en.trim() !== ''
          ? meta.product_model_name_en
          : undefined) ??
        (typeof meta?.name_en === 'string' && meta.name_en.trim() !== '' ? meta.name_en : undefined) ??
        (typeof rep.product_model_name_en === 'string' && rep.product_model_name_en.trim() !== ''
          ? rep.product_model_name_en
          : undefined) ??
        (rep.name_en ?? '');

      const nameFi =
        (typeof meta?.product_model_name_fi === 'string' && meta.product_model_name_fi.trim() !== ''
          ? meta.product_model_name_fi
          : undefined) ??
        (typeof meta?.name_fi === 'string' && meta.name_fi.trim() !== '' ? meta.name_fi : undefined) ??
        (typeof rep.product_model_name_fi === 'string' && rep.product_model_name_fi.trim() !== ''
          ? rep.product_model_name_fi
          : undefined) ??
        (rep.name_fi ?? null);

      const nameSv =
        (typeof meta?.product_model_name_sv === 'string' && meta.product_model_name_sv.trim() !== ''
          ? meta.product_model_name_sv
          : undefined) ??
        (typeof meta?.name_sv === 'string' && meta.name_sv.trim() !== '' ? meta.name_sv : undefined) ??
        (typeof rep.product_model_name_sv === 'string' && rep.product_model_name_sv.trim() !== ''
          ? rep.product_model_name_sv
          : undefined) ??
        (rep.name_sv ?? null);

      // short_description_en from metadata (parent row in CSV)
      const shortDescriptionEn = typeof meta?.short_description_en === 'string' && meta.short_description_en.trim() !== ''
        ? meta.short_description_en.trim()
        : null;

      if (shortDescriptionEn) {
        log.debug({ modelCode, desc: shortDescriptionEn.substring(0, 80) }, 'promote: model description from parent metadata');
      } else {
        log.debug({ modelCode, metaShortDesc: meta?.short_description_en }, 'promote: model has NO description (parent metadata missing or empty)');
      }

      if (nameEn === '' || brandRaw === '' || vendorRaw === '' || categoryCodes.length === 0) {
        continue;
      }

      modelsToPromote.push({
        model_code: modelCode,
        name_en: nameEn,
        name_fi: nameFi,
        name_sv: nameSv,
        brand: brandRaw,
        vendor_name: vendorRaw,
        category_codes: categoryCodes,
        catalog_restriction: (meta?.catalog_restriction ?? rep.catalog_restriction) ?? null,
        short_description_en: shortDescriptionEn,
        imported_at: nowIso,
      });
    }

    const promotedModelCodes = new Set(modelsToPromote.map((m) => m.model_code));
    const filteredVariantsToPromote = variantsToPromote.filter((v) => promotedModelCodes.has(v.model_code));

    if (filteredVariantsToPromote.length === 0) {
      log.info('No variants left to promote after filtering by promotable models');
      return;
    }

    logBoundarySample('pre-prod:product_models', modelsToPromote as any, undefined, log);
    logBoundarySample('pre-prod:product_variants', filteredVariantsToPromote as any, undefined, log);

    const modelBatches = Math.ceil(modelsToPromote.length / BATCH_SIZE);
    log.info(`Promoting ${modelsToPromote.length} product models to production in ${modelBatches} batches`);
    for (let i = 0; i < modelBatches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, modelsToPromote.length);
      const batch = modelsToPromote.slice(start, end);
      await dbClient.upsert('product_models', batch, 'model_code', {
        boundary: 'pipeline.pre-prod.product_models',
      });
      log.info(`Batch ${i + 1}/${modelBatches} complete (${batch.length} product models)`);
    }

    const variantBatches = Math.ceil(filteredVariantsToPromote.length / BATCH_SIZE);
    log.info(`Promoting ${filteredVariantsToPromote.length} product variants to production in ${variantBatches} batches`);
    for (let i = 0; i < variantBatches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, filteredVariantsToPromote.length);
      const batch = filteredVariantsToPromote.slice(start, end);
      await dbClient.upsert('product_variants', batch, 'product_code', {
        boundary: 'pipeline.pre-prod.product_variants',
      });
      log.info(`Batch ${i + 1}/${variantBatches} complete (${batch.length} product variants)`);
    }

    log.info('Successfully promoted models + variants to production', {
      models: modelsToPromote.length,
      variants: filteredVariantsToPromote.length,
    });
  } catch (error) {
    const err = error as Error;
    log.error('Failed to promote models + variants to production', { error: err.message });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Store sync (store-agnostic) reads + bookkeeping
//
// These power the storefront push (currently Shopify). They are deliberately
// store-agnostic so a future storefront swap only touches the storefront client,
// not the pipeline/DB layer.
// ---------------------------------------------------------------------------

export type ProductionModel = {
  model_code: string;
  name_en: string;
  name_fi: string | null;
  name_sv: string | null;
  brand: string;
  vendor_name: string;
  category_codes: string[];
  catalog_restriction: string | null;
  short_description_en: string | null;
  imported_at: string;
  last_synced_at: string | null;
};

export type ProductionVariant = {
  product_code: string;
  model_code: string;
  name_en: string;
  barcode: string;
  price_eur_excl_vat: number;
  price_eur_incl_vat: number;
  price_dkk_excl_vat: number;
  stock_total: number;
  stock_vaasa: number | null;
  stock_sweden: number | null;
  image_urls: string[];
  imported_at: string;
  last_synced_at: string | null;
};

export type ModelWithVariants = {
  model: ProductionModel;
  variants: ProductionVariant[];
};

export type StoreProductLink = {
  model_code: string;
  external_product_id: string;
  external_handle: string | null;
  last_synced_at: string | null;
  last_pushed_product_hash: string | null;
  last_pushed_stock_hash: string | null;
};

const STORE_PAGE_SIZE = 1000;

/**
 * Read every row of a production table using offset pagination so the push
 * scales to the full feed (~120k variants) without loading partial pages.
 */
async function selectAllPaged<T>(
  table: string,
  orderColumn: string
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await dbClient.select<T>(
      table,
      '*',
      undefined,
      STORE_PAGE_SIZE,
      { column: orderColumn, ascending: true },
      offset
    );
    all.push(...page);
    if (page.length < STORE_PAGE_SIZE) break;
    offset += STORE_PAGE_SIZE;
  }
  return all;
}

/**
 * Load the full promoted catalogue (production models joined with their variants),
 * grouped by model. Models with zero variants are skipped (Shopify products need
 * at least one variant).
 */
export async function getPromotedModelsWithVariants(): Promise<ModelWithVariants[]> {
  const [models, variants] = await Promise.all([
    selectAllPaged<ProductionModel>('product_models', 'model_code'),
    selectAllPaged<ProductionVariant>('product_variants', 'product_code'),
  ]);

  const variantsByModel = new Map<string, ProductionVariant[]>();
  for (const v of variants) {
    const list = variantsByModel.get(v.model_code) ?? [];
    list.push(v);
    variantsByModel.set(v.model_code, list);
  }

  const out: ModelWithVariants[] = [];
  for (const model of models) {
    const modelVariants = variantsByModel.get(model.model_code) ?? [];
    if (modelVariants.length === 0) continue;
    out.push({ model, variants: modelVariants });
  }

  log.info('Loaded promoted catalogue for store sync', {
    models: out.length,
    variants: variants.length,
  });
  return out;
}

/**
 * Read all known external-store product links (model_code -> external product id).
 * Used to reconcile deletions: any link not present in the current promoted set
 * is removed from the storefront.
 */
export async function getAllStoreProductLinks(): Promise<StoreProductLink[]> {
  return selectAllPaged<StoreProductLink>('store_product_links', 'model_code');
}

/**
 * Upsert the mapping between a local model and its external storefront product.
 */
export async function upsertStoreProductLink(link: {
  model_code: string;
  external_product_id: string;
  external_handle?: string | null;
  last_pushed_product_hash?: string | null;
  last_pushed_stock_hash?: string | null;
}): Promise<void> {
  try {
    await dbClient.upsert(
      'store_product_links',
      [
        {
          model_code: link.model_code,
          external_product_id: link.external_product_id,
          external_handle: link.external_handle ?? null,
          last_pushed_product_hash: link.last_pushed_product_hash ?? null,
          last_pushed_stock_hash: link.last_pushed_stock_hash ?? null,
          last_synced_at: new Date().toISOString(),
        },
      ],
      'model_code',
      { boundary: 'pipeline.store.store_product_links' }
    );
  } catch (error) {
    const err = error as Error;
    log.error('Failed to upsert store product link', { error: err.message, modelCode: link.model_code });
    throw error;
  }
}

/**
 * Upsert a variant link (product_code -> external variant + inventory item ids).
 */
export async function upsertStoreVariantLink(link: {
  product_code: string;
  model_code: string;
  external_variant_id: string;
  external_inventory_item_id?: string | null;
}): Promise<void> {
  try {
    await dbClient.upsert(
      'store_variant_links',
      [
        {
          product_code: link.product_code,
          model_code: link.model_code,
          external_variant_id: link.external_variant_id,
          external_inventory_item_id: link.external_inventory_item_id ?? null,
          last_synced_at: new Date().toISOString(),
        },
      ],
      'product_code',
      { boundary: 'pipeline.store.store_variant_links' }
    );
  } catch (error) {
    const err = error as Error;
    log.error('Failed to upsert store variant link', { error: err.message, productCode: link.product_code });
    throw error;
  }
}

/**
 * Remove a model's links (product + its variants) after the product has been
 * deleted from the storefront.
 */
export async function deleteStoreProductLink(modelCode: string): Promise<void> {
  try {
    await dbClient.delete('store_variant_links', { model_code: modelCode });
    await dbClient.delete('store_product_links', { model_code: modelCode });
  } catch (error) {
    const err = error as Error;
    log.error('Failed to delete store product link', { error: err.message, modelCode });
    throw error;
  }
}

export type StoreVariantLink = {
  product_code: string;
  model_code: string;
  external_variant_id: string;
  external_inventory_item_id: string | null;
  last_synced_at: string | null;
};

/**
 * Read all variant links for a given model. Used by the inventory-only fast
 * path to map product_codes to Shopify inventory item ids without calling
 * the Shopify API.
 */
export async function getAllStoreVariantLinks(modelCode: string): Promise<StoreVariantLink[]> {
  return dbClient.select<StoreVariantLink>('store_variant_links', '*', { model_code: modelCode });
}

/**
 * Stamp last_synced_at on a promoted model after a successful push.
 */
export async function updateModelSyncStatus(modelCode: string, lastSyncedAt: Date): Promise<void> {
  try {
    await dbClient.update(
      'product_models',
      { last_synced_at: lastSyncedAt.toISOString() },
      { model_code: modelCode }
    );
  } catch (error) {
    const err = error as Error;
    log.error('Failed to update model sync status', { error: err.message, modelCode });
    // Non-fatal: bookkeeping only.
  }
}

/**
 * Log a store sync result (store-agnostic). Never throws — logging failures must
 * not break the sync.
 */
export async function logStoreSync(entry: {
  scope: 'product' | 'variant';
  local_code: string;
  external_id?: string | null;
  action: 'create' | 'update' | 'delete';
  status: 'success' | 'failed';
  message?: string;
}): Promise<void> {
  try {
    await dbClient.insert(
      'store_sync_logs',
      [
        {
          scope: entry.scope,
          local_code: entry.local_code,
          external_id: entry.external_id ?? null,
          action: entry.action,
          status: entry.status,
          message: entry.message ?? null,
          synced_at: new Date().toISOString(),
        },
      ],
      { boundary: 'pipeline.store.store_sync_logs' }
    );
  } catch (error) {
    const err = error as Error;
    log.error('Failed to log store sync', { error: err.message, localCode: entry.local_code });
    // Don't throw.
  }
}