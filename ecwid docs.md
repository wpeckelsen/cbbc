can I upload product batches?
Use the batch endpoint:

POST https://app.ecwid.com/api/v3/{storeId}/batch

For adding products, include one or more POST /products requests in the batch body. The individual create-product call is POST https://app.ecwid.com/api/v3/{storeId}/products, but in batch mode the path is just "/products".

Example batch item:


Copy
{
  "path": "/products",
  "method": "POST",
  "body": {
    "name": "New Product",
    "price": 19.99,
    "sku": "0012199"
  }
}
The batch request accepts up to 500 API calls. You can also add allowParallelMode=true to process up to 100 requests at once.

Useful pages:

Create batch request

Create product

If you want, I can show a full batch payload for creating multiple products at once.

Need auth scopes for batch?

Explored with 1 tool
Yes — the batch endpoint itself does not require access scopes for status/cancel/delete calls, but the requests inside the batch must have all scopes their endpoints require.

For creating products in batch, the wrapped POST /products request needs:

create_catalog

So the auth rule is:

POST /batch — use your normal bearer token

POST /products inside the batch — requires create_catalog



-for a product, what fields are allowed, and what is required?

Explored with 1 tool
For POST /products, the required fields are:

sku

name

price

Everything else in the product schema is optional.

Allowed fields include, among others:

Inventory: quantity, unlimited, inStock, warningLimit

Catalog: categoryIds, defaultCategoryId, productClassId, enabled

Pricing: compareToPrice, wholesalePrices, lowestPriceSettings

Shipping: isShippingRequired, weight, fixedShippingRateOnly, fixedShippingRate, shipping, dimensions, volume

Content: description, descriptionTranslated, subtitle, seoTitle, seoDescription

Options and variants: options, combinations with saveCombinations=true

Tax and attributes: tax, attributes

Media and files: files, media, relatedProducts

Misc: externalReferenceId, isGiftCard, discountsAllowed, reviewsCollectingAllowed, compositeParents, compositeComponents

A few important constraints:

combinations are only processed when you pass saveCombinations=true.

options supports types like SELECT, RADIO, CHECKBOX, TEXTFIELD, TEXTAREA, DATE, FILES, SIZE, and SWATCHES.

shipping.type can be GLOBAL_METHODS, SELECTED_METHODS, FLAT_RATE, or FREE_SHIPPING.