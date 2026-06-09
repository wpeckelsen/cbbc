import { ModelWithVariants, ProductionModel, ProductionVariant } from '../api/products-api';

/**
 * Storefront-facing mapping rules (Supabase production tables -> Shopify).
 *
 * Field mapping:
 * - product title       <- model.name_en
 * - product vendor      <- model.vendor_name (brand is intentionally dropped)
 * - product tags        <- model.category_codes
 * - product handle      <- cbbc-{model_code}  (stable upsert key)
 * - metafield           <- cbbc.model_code
 * - variant sku         <- variant.product_code
 * - variant barcode     <- variant.barcode
 * - variant price       <- variant.price_eur_excl_vat (Shopify applies VAT)
 * - variant option      <- variant.name_en (only for multi-variant models)
 * - variant image       <- variant.image_url
 * - inventory           <- variant.stock_total (single location; handled separately)
 */

export const METAFIELD_NAMESPACE = 'cbbc';
export const METAFIELD_MODEL_CODE_KEY = 'model_code';
export const VARIANT_OPTION_NAME = 'Name';

export function handleForModel(modelCode: string): string {
  // Shopify handles are lowercased, alphanumeric + hyphens.
  const slug = modelCode
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `cbbc-${slug}`;
}

function priceString(variant: ProductionVariant): string {
  // Shopify expects price as a decimal string.
  return Number(variant.price_eur_excl_vat).toFixed(2);
}

function distinct<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/**
 * Build the `ProductSetInput` for a model and its variants.
 *
 * Single-variant models use Shopify's default option (no awkward duplicate
 * label); multi-variant models expose a "Name" option whose value is each
 * variant's English name.
 *
 * `existingProductId`, when provided, makes productSet update in place.
 */
export function buildProductSetInput(
  entry: ModelWithVariants,
  existingProductId: string | null
): Record<string, unknown> {
  const { model, variants } = entry;
  const isMultiVariant = variants.length > 1;

  // Shopify requires option values to be unique within a product. Variant names
  // can collide, so disambiguate duplicates with the product_code.
  const optionValueByCode = buildUniqueOptionValues(model, variants);

  // Product-level media: every distinct variant image becomes product media so
  // variants can reference it by originalSource.
  const imageUrls = distinct(
    variants.map((v) => v.image_url).filter((u): u is string => typeof u === 'string' && u !== '')
  );

  const files = imageUrls.map((url) => ({
    originalSource: url,
    contentType: 'IMAGE',
  }));

  const variantInputs = variants.map((v) => {
    const variant: Record<string, unknown> = {
      sku: v.product_code,
      barcode: v.barcode,
      price: priceString(v),
      inventoryItem: { tracked: true },
    };

    if (isMultiVariant) {
      variant.optionValues = [{ optionName: VARIANT_OPTION_NAME, name: optionValueByCode.get(v.product_code)! }];
    }

    if (v.image_url) {
      variant.file = { originalSource: v.image_url, contentType: 'IMAGE' };
    }

    return variant;
  });

  const input: Record<string, unknown> = {
    title: model.name_en,
    handle: handleForModel(model.model_code),
    vendor: model.vendor_name,
    status: 'ACTIVE',
    tags: normalizeTags(model.category_codes),
    metafields: [
      {
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_MODEL_CODE_KEY,
        type: 'single_line_text_field',
        value: model.model_code,
      },
    ],
    variants: variantInputs,
  };

  if (isMultiVariant) {
    input.productOptions = [
      {
        name: VARIANT_OPTION_NAME,
        values: variants.map((v) => ({ name: optionValueByCode.get(v.product_code)! })),
      },
    ];
  }

  if (files.length > 0) {
    input.files = files;
  }

  if (existingProductId) {
    input.id = existingProductId;
  }

  return input;
}

/**
 * Map each variant's product_code to a unique, non-empty option value derived
 * from its English name. Empty names fall back to product_code; duplicate names
 * are disambiguated by appending the product_code.
 */
function buildUniqueOptionValues(
  _model: ProductionModel,
  variants: ProductionVariant[]
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const v of variants) {
    const base = baseOptionValue(v);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const v of variants) {
    const base = baseOptionValue(v);
    let value = (counts.get(base) ?? 0) > 1 ? `${base} (${v.product_code})` : base;
    // Final guard against any residual collision.
    while (used.has(value)) value = `${value}-${v.product_code}`;
    used.add(value);
    result.set(v.product_code, value);
  }
  return result;
}

function baseOptionValue(variant: ProductionVariant): string {
  const name = (variant.name_en ?? '').trim();
  return name !== '' ? name : variant.product_code;
}

function normalizeTags(categoryCodes: string[] | null | undefined): string[] {
  if (!Array.isArray(categoryCodes)) return [];
  return distinct(
    categoryCodes
      .map((c) => (c === null || c === undefined ? '' : String(c).trim()))
      .filter((c) => c !== '')
  );
}
