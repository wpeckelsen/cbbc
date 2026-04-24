import { supabaseClient } from './supabase-client';
import { ValidatedProduct } from '../validation/product-validator';
import { logger } from '../logger';

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
            if (key === 'categories' && product[key]) {
                transformedProduct['category_codes'] = product[key].split(',').map((cat: string) => cat.trim()).filter((cat: string) => cat !== '');
            } else if (key === 'created' || key === 'updated') {
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
                transformedProduct[dbKey] = product[key];
            }
        }
    }

    // Add imported_at timestamp
    transformedProduct['imported_at'] = new Date().toISOString();

    return transformedProduct;
}

/**
 * Insert products into staging table (with batching for large datasets)
 */
export async function insertProductsStaging(products: any[]): Promise<void> {
  if (products.length === 0) {
    logger.info('No products to insert into staging');
    return;
  }

  const BATCH_SIZE = 1000; // Process 1000 products at a time
  const batches = Math.ceil(products.length / BATCH_SIZE);

  try {
    logger.info(`Inserting ${products.length} products into staging in ${batches} batches`);
    
    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, products.length);
      const batch = products.slice(start, end);
      
      // Transform the batch to map FTP column names to DB column names
      const transformedBatch = batch.map(transformProductKeys);
      
      await supabaseClient.upsert('products_staging', transformedBatch, 'product_code');
      logger.info(`Batch ${i + 1}/${batches} complete (${batch.length} products)`);
    }
    
    logger.info(`Successfully inserted ${products.length} products into staging`);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to insert products into staging', { error: err.message });
    throw error;
  }
}

/**
 * Insert prices into staging table (with batching for large datasets)
 */
export async function insertPricesStaging(prices: any[]): Promise<void> {
  if (prices.length === 0) {
    logger.info('No prices to insert into staging');
    return;
  }

  const BATCH_SIZE = 1000;
  
  try {
    const formattedPrices = prices.map(price => ({
      product_code: price.PRODUCT_CODE,
      eur_excl_vat: price.EUR_EXCL_VAT,
      eur_incl_vat: price.EUR_INCL_VAT,
      eur_excl_vat_eu: price.EUR_EXCL_VAT_EU,
      eur_incl_vat_eu: price.EUR_INCL_VAT_EU,
      sek_excl_vat: price.SEK_EXCL_VAT,
      sek_incl_vat: price.SEK_INCL_VAT,
      nok_excl_vat: price.NOK_EXCL_VAT,
      nok_incl_vat: price.NOK_INCL_VAT,
      gbp_excl_vat: price.GBP_EXCL_VAT,
      dkk_excl_vat: price.DKK_EXCL_VAT,
      dkk_incl_vat: price.DKK_INCL_VAT,
      imported_at: new Date().toISOString(),
    }));

    const batches = Math.ceil(formattedPrices.length / BATCH_SIZE);
    logger.info(`Inserting ${formattedPrices.length} prices into staging in ${batches} batches`);
    
    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, formattedPrices.length);
      const batch = formattedPrices.slice(start, end);
      
      await supabaseClient.upsert('prices_staging', batch, 'product_code');
      logger.info(`Batch ${i + 1}/${batches} complete (${batch.length} prices)`);
    }
    
    logger.info(`Successfully inserted ${formattedPrices.length} prices into staging`);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to insert prices into staging', { error: err.message });
    throw error;
  }
}

/**
 * Insert stock data into staging table (with batching for large datasets)
 */
export async function insertStockStaging(stock: any[], source: string): Promise<void> {
  if (stock.length === 0) {
    logger.info(`No stock data to insert into staging (source: ${source})`);
    return;
  }

  const BATCH_SIZE = 1000;
  
  try {
    const formattedStock = stock.map(item => ({
      product_code: item.PRODUCT_CODE || null,
      ean: item.EAN || null,
      vaasa: item.VAASA || 0,
      sweden: item.SWEDEN || 0,
      total: item.TOTAL || 0,
      source: source,
      imported_at: new Date().toISOString(),
    }));

    const batches = Math.ceil(formattedStock.length / BATCH_SIZE);
    logger.info(`Inserting ${formattedStock.length} stock records into staging in ${batches} batches (source: ${source})`);
    
    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, formattedStock.length);
      const batch = formattedStock.slice(start, end);
      
      await supabaseClient.insert('stock_staging', batch);
      logger.info(`Batch ${i + 1}/${batches} complete (${batch.length} stock records)`);
    }
    
    logger.info(`Successfully inserted ${formattedStock.length} stock records into staging (source: ${source})`);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to insert stock into staging', { error: err.message, source });
    throw error;
  }
}

/**
 * Insert categories
 */
export async function insertCategories(categories: any[]): Promise<void> {
  if (categories.length === 0) {
    logger.info('No categories to insert');
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

    logger.info(`Deduplicated categories: ${categories.length} -> ${deduped.length} (prefer English, lang 2)`);
    await supabaseClient.upsert('categories', deduped, 'id');
    logger.info(`Inserted ${deduped.length} categories`);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to insert categories', { error: err.message });
    throw error;
  }
}

/**
 * Insert category hierarchy
 */
export async function insertCategoryHierarchy(hierarchy: any[]): Promise<void> {
  if (hierarchy.length === 0) {
    logger.info('No category hierarchy to insert');
    return;
  }

  try {
    // Transform uppercase CSV keys to lowercase database keys
    const formattedHierarchy = hierarchy.map(h => ({
      id: h.GROUP_ID,
      prev_category: h.PREV_GROUP,
      category_level: parseInt(h.GROUP_LEVEL) || 0
    }));
    
    await supabaseClient.upsert('category_hierarchy', formattedHierarchy, 'id');
    logger.info(`Inserted ${formattedHierarchy.length} category hierarchy records`);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to insert category hierarchy', { error: err.message });
    throw error;
  }
}

/**
 * Insert images into staging table (with batching for large datasets)
 */
export async function insertImagesStaging(images: any[]): Promise<void> {
  if (images.length === 0) {
    logger.info('No images to insert into staging');
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
    logger.info(`Inserting ${formattedImages.length} images into staging in ${batches} batches`);
    
    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, formattedImages.length);
      const batch = formattedImages.slice(start, end);
      
      await supabaseClient.insert('images_staging', batch);
      logger.info(`Batch ${i + 1}/${batches} complete (${batch.length} images)`);
    }
    
    logger.info(`Successfully inserted ${formattedImages.length} images into staging`);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to insert images into staging', { error: err.message });
    throw error;
  }
}

/**
 * Promote validated products to production table (with batching for large datasets)
 */
export async function promoteToProduction(validatedProducts: ValidatedProduct[]): Promise<void> {
  if (validatedProducts.length === 0) {
    logger.info('No products to promote to production');
    return;
  }

  const BATCH_SIZE = 1000;
  
  try {
    const productsToPromote = validatedProducts.map(product => {
      const status = product.errors.length === 0 ? 'valid' : 'invalid';
      
      return {
        product_code: product.product_code,
        name_en: product.name_en,
        name_fi: product.name_fi,
        name_sv: product.name_sv,
        brand: product.brand,
        category_codes: product.category_codes,
        price_eur_excl_vat: product.price_eur_excl_vat,
        price_eur_incl_vat: product.price_eur_incl_vat,
        stock_total: product.stock_total,
        stock_vaasa: product.stock_vaasa,
        stock_sweden: product.stock_sweden,
        barcode: product.barcode,
        vendor_name: product.vendor_name,
        catalog_restriction: product.catalog_restriction,
        image_url: product.image_url,
        imported_at: new Date().toISOString(),
        status: status,
      };
    });

    const batches = Math.ceil(productsToPromote.length / BATCH_SIZE);
    logger.info(`Promoting ${productsToPromote.length} products to production in ${batches} batches`);
    
    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, productsToPromote.length);
      const batch = productsToPromote.slice(start, end);
      
      await supabaseClient.upsert('products', batch, 'product_code');
      logger.info(`Batch ${i + 1}/${batches} complete (${batch.length} products)`);
    }
    
    logger.info(`Successfully promoted ${productsToPromote.length} products to production`);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to promote products to production', { error: err.message });
    throw error;
  }
}

/**
 * Get products from production table
 */
export async function getProductsFromProduction(limit?: number): Promise<any[]> {
  try {
    const products = await supabaseClient.select('products', '*', undefined, limit);
    logger.info(`Retrieved ${products.length} products from production`);
    return products;
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to get products from production', { error: err.message });
    throw error;
  }
}

/**
 * Update product sync status
 */
export async function updateProductSyncStatus(
  productCode: string,
  lastSyncedAt: Date
): Promise<void> {
  try {
    await supabaseClient.update(
      'products',
      { last_synced_at: lastSyncedAt.toISOString() },
      { product_code: productCode }
    );
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to update product sync status', { 
      error: err.message, 
      productCode 
    });
    throw error;
  }
}

/**
 * Log Ecwid sync result
 */
export async function logEcwidSync(
  productCode: string,
  ecwidItemId: string | null,
  status: 'success' | 'failed',
  message?: string
): Promise<void> {
  try {
    const logEntry = {
      product_code: productCode,
      ecwid_item_id: ecwidItemId,
      synced_at: new Date().toISOString(),
      status: status,
      message: message || null,
    };

    await supabaseClient.insert('ecwid_sync_logs', [logEntry]);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to log Ecwid sync', { 
      error: err.message, 
      productCode 
    });
    // Don't throw - logging failures shouldn't break the sync
  }
}
