# SeedConfig Schema Alignment Audit

**Date:** 2025-01-16  
**Purpose:** Verify SeedConfig schema alignment with Shopify API and database requirements

## Executive Summary

This audit compares the `SeedConfig` schema against:
1. Shopify Admin API requirements (draft order creation)
2. WMS database schema requirements (order, variantOrder, prep, collectionPrep)
3. Existing request/response schemas in the codebase

## Findings

### ✅ Shopify API Alignment

**Current SeedConfig Structure:**
```typescript
{
  orders: [{
    customer: { name: string, email: string },
    lineItems: [{ sku: string, quantity: number, pickType: "Regular" | "Pick and Pack", hasBarcode?: boolean }]
  }]
}
```

**Shopify API Requirements (from ShopifyService):**
- ✅ Customer: `{ name: string, email: string }` - **MATCHES**
- ✅ Line Items: `{ sku: string, quantity: number }` - **MATCHES** (pickType and hasBarcode are WMS-specific, not sent to Shopify)
- ✅ Additional fields handled by service: tags, customAttributes, note

**Verdict:** ✅ **ALIGNED** - SeedConfig structure matches Shopify API expectations. The service correctly maps SKUs to variant IDs and adds metadata.

### ⚠️ Database Schema Alignment

**Current SeedConfig Structure:**
```typescript
{
  orders: [{
    customer: { name: string, email: string },
    lineItems: [{ sku: string, quantity: number, pickType: "Regular" | "Pick and Pack" }]
  }],
  collectionPrep?: {
    carrier: string,
    locationId: string,
    region: string,
    prepDate: string
  }
}
```

**Database Schema Requirements (from Prisma):**

1. **Order Table:**
   - Required: `shopifyOrderId`, `shopifyOrderNumber`, `status`, `region`
   - Optional: `locationId`, `customerId`, address fields
   - **Gap Identified:** `locationId` is not in `SeedConfig.orders`, but:
     - `WmsService.createOrderWithCustomer` accepts optional `locationId`
     - `ConfigGeneratorService` captures `locationId` from customer but doesn't store it in config
     - Location is determined from customer's `locationId` in customer config

2. **VariantOrder Table:**
   - Required: `orderId`, `variantId`, `lineItemId`, `quantity`, `region`
   - ✅ **ALIGNED** - Service maps SKUs to variant IDs and line items correctly

3. **Prep Table:**
   - Required: `orderId`, `prep`, `variantId`, `lineItemId`, `region`
   - Optional: `locationId`, `collectionPrepId`
   - ✅ **ALIGNED** - Service creates preps from orders

4. **CollectionPrep Table:**
   - Required: `id`, `carrier`, `locationId`, `prepDate`, `boxes`, `region`
   - ✅ **ALIGNED** - All required fields present in `SeedConfig.collectionPrep`

### 🔍 Gap Analysis

#### Gap 1: locationId in Orders (LOW PRIORITY)

**Issue:** `SeedConfig.orders` does not include `locationId`, but:
- Location is determined from customer's `locationId` in customer config
- `WmsService.createOrderWithCustomer` accepts optional `locationId`
- Current implementation: `ConfigGeneratorService` captures `locationId` from customer but doesn't store it in generated config

**Impact:** 
- ✅ **LOW** - Location is correctly determined from customer during generation
- ✅ **LOW** - WMS service accepts optional `locationId`, so it can be passed at runtime
- ⚠️ **MINOR** - If config is manually edited, locationId would need to be re-inferred from customer

**Recommendation:** 
- **Option A (Current):** Keep locationId derived from customer at runtime - **RECOMMENDED**
- **Option B:** Add optional `locationId` to `SeedConfig.orders` for explicit storage

**Decision:** Keep current approach (Option A) - locationId is correctly derived from customer, and adding it to schema would be redundant since it's always determined from customer selection.

#### Gap 2: Order Status Field (NONE)

**Issue:** `SeedConfig` doesn't include order `status` field.

**Impact:**
- ✅ **NONE** - Status is set by the service during WMS entity creation (defaults to appropriate status)

**Recommendation:** No change needed - status is a runtime concern, not a config concern.

#### Gap 3: Customer ID vs Customer Data (NONE)

**Issue:** Database `order` table has `customerId`, but `SeedConfig` only has customer name/email.

**Impact:**
- ✅ **NONE** - `WmsService.createOrderWithCustomer` handles customer upsert and returns `customerId`
- ✅ **NONE** - Customer is created/updated from name/email during seeding

**Recommendation:** No change needed - customer ID is generated during seeding.

### ✅ Validation Alignment

**Current Validation:**
- ✅ Zod schema validation (`seedConfigSchema`)
- ✅ Shopify API alignment validation (`ConfigValidationService.validateShopifyAlignment`)
- ✅ Database schema alignment validation (`ConfigValidationService.validateDatabaseAlignment`)
- ✅ Data validation (`DataValidationService`)

**Verdict:** ✅ **COMPREHENSIVE** - Multi-layer validation ensures alignment.

## Recommendations

### ✅ No Schema Changes Required

The current `SeedConfig` schema is **well-aligned** with both Shopify API and database requirements:

1. **Shopify API:** ✅ All required fields present, service handles mapping
2. **Database Schema:** ✅ All required fields handled by services, optional fields (like `locationId`) are correctly derived
3. **LocationId Handling:** ✅ Correctly derived from customer selection, no need to duplicate in config

### 📝 Documentation Updates

1. ✅ Document that `locationId` is derived from customer's `locationId` in customer config
2. ✅ Document that `orderType` is auto-determined from line items' `pickType` values
3. ✅ Document that `status` and `customerId` are set during seeding, not in config

## Conclusion

**Status:** ✅ **SCHEMA IS ALIGNED**

The `SeedConfig` schema correctly represents the data needed for:
- Shopify draft order creation (customer, line items)
- WMS entity creation (orders, preps, collection preps)
- Validation and error checking

The identified "gap" (locationId in orders) is actually handled correctly through customer selection, and adding it to the schema would be redundant.

**No schema changes required.**
