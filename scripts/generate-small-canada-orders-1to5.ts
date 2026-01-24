#!/usr/bin/env tsx

/**
 * Generate small Canada order configs with 1-5 boxes (items) per order
 * Focuses on reasonable orders perfect for testing
 *
 * Usage:
 *   npx tsx scripts/generate-small-canada-orders-1to5.ts [--seed <number>] [--batches <number>]
 *
 * Options:
 *   --seed <number>    Optional seed for deterministic output (default: random)
 *   --batches <number> Number of config batches to generate (default: 10)
 *
 * Examples:
 *   npx tsx scripts/generate-small-canada-orders-1to5.ts
 *   npx tsx scripts/generate-small-canada-orders-1to5.ts --seed 12345 --batches 15
 */

import { config } from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { initializeEnvConfig, getShopifyConfig } from "../src/config/env";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SeedConfig } from "../src/shared/validation/seedConfigSchema";
import { seedConfigSchema } from "../src/shared/validation/seedConfigSchema";
import type { Variant } from "../src/repositories/ConfigDataRepository";

// Load .env files
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

interface Customer {
  id: string;
  name: string;
  email: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  region: "CA" | "US";
}

interface SKUCatalog {
  regular: Variant[];
  pickAndPack: Variant[];
  all: Variant[];
}

/**
 * Seeded pseudo-random number generator (Linear Congruential Generator)
 * Provides deterministic random numbers when given a seed
 */
class SeededRNG {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * Generate next random number between 0 and 1
   */
  random(): number {
    // LCG parameters (from Numerical Recipes)
    this.seed = (this.seed * 1664525 + 1013904223) % 2 ** 32;
    return this.seed / 2 ** 32;
  }

  /**
   * Generate random integer between min (inclusive) and max (exclusive)
   */
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min)) + min;
  }
}

/**
 * Fetch all SKUs from Shopify and get their pickType from database
 */
async function fetchShopifySkusWithPickTypes(region: string = "CA"): Promise<SKUCatalog> {
  await initializeEnvConfig();
  const shopifyConfig = getShopifyConfig(region as "CA" | "US");
  const client = createAdminApiClient({
    storeDomain: shopifyConfig.storeDomain,
    apiVersion: shopifyConfig.apiVersion,
    accessToken: shopifyConfig.accessToken,
  });

  const shopifySkus = new Set<string>();
  let hasNextPage = true;
  let cursor: string | null = null;
  let pageCount = 0;

  console.log(`\n🔍 Fetching all SKUs from Shopify staging...`);

  // Fetch all SKUs from Shopify
  while (hasNextPage) {
    const query = `
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              variants(first: 250) {
                edges {
                  node {
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await client.request(query, {
        variables: { first: 250, after: cursor },
      });

      const products = response.data?.products?.edges || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageInfo: any = response.data?.products?.pageInfo;

      for (const productEdge of products) {
        const variants = productEdge.node.variants.edges || [];
        for (const variantEdge of variants) {
          const sku = variantEdge.node.sku;
          if (sku) {
            shopifySkus.add(sku);
          }
        }
      }

      pageCount++;
      hasNextPage = pageInfo?.hasNextPage ?? false;
      cursor = pageInfo?.endCursor ?? null;

      if (pageCount % 10 === 0 || !hasNextPage) {
        console.log(`   Fetched page ${pageCount} - ${shopifySkus.size} unique SKUs found so far...`);
      }
    } catch (error) {
      console.error(
        `   ⚠️  Error fetching page ${pageCount + 1}:`,
        error instanceof Error ? error.message : String(error),
      );
      hasNextPage = false; // Stop on error
    }
  }

  console.log(`✅ Fetched ${shopifySkus.size} unique SKUs from Shopify\n`);

  // Now query database to get pickType for each Shopify SKU
  console.log(`🔍 Looking up pickType for ${shopifySkus.size} SKUs in database...\n`);
  const prisma = new PrismaClient();

  try {
    // Get all variants from database that match Shopify SKUs
    const shopifySkuArray = Array.from(shopifySkus);
    const BATCH_SIZE = 1000; // Process in batches to avoid huge IN clause

    const allVariants: Variant[] = [];

    for (let i = 0; i < shopifySkuArray.length; i += BATCH_SIZE) {
      const batch = shopifySkuArray.slice(i, i + BATCH_SIZE);
      const variants = await prisma.variant.findMany({
        where: {
          region,
          disabled: false,
          sku: { in: batch },
        },
        select: {
          id: true,
          sku: true,
          modelName: true,
          colorId: true,
          shopifyIds: true,
          region: true,
          description: true,
        },
      });

      // Get variant parts to determine pickType
      const variantIds = variants.map((v) => v.id);
      const variantParts = await prisma.variantPart.findMany({
        where: {
          variantId: { in: variantIds },
        },
        include: {
          part: {
            select: {
              pickType: true,
            },
          },
        },
      });

      // Group variantParts by variantId
      const variantPartsByVariantId = new Map<string, typeof variantParts>();
      for (const vp of variantParts) {
        const existing = variantPartsByVariantId.get(vp.variantId) || [];
        existing.push(vp);
        variantPartsByVariantId.set(vp.variantId, existing);
      }

      // Determine pickType for each variant
      for (const variant of variants) {
        const vps = variantPartsByVariantId.get(variant.id) || [];
        let pickType: "Regular" | "Pick and Pack" = "Regular";
        if (vps.length > 0) {
          const pickTypeCounts = new Map<string, number>();
          for (const vp of vps) {
            const pt = vp.part.pickType;
            pickTypeCounts.set(pt, (pickTypeCounts.get(pt) || 0) + 1);
          }
          let maxCount = 0;
          for (const [pt, count] of pickTypeCounts.entries()) {
            if (count > maxCount) {
              maxCount = count;
              pickType = pt as "Regular" | "Pick and Pack";
            }
          }
        }

        allVariants.push({
          id: variant.id,
          sku: variant.sku,
          modelName: variant.modelName,
          colorId: variant.colorId,
          shopifyIds: variant.shopifyIds,
          region: variant.region,
          description: variant.description,
          pickType,
        });
      }
    }

    const regular = allVariants.filter((v) => v.pickType === "Regular");
    const pickAndPack = allVariants.filter((v) => v.pickType === "Pick and Pack");

    console.log(`✅ Found pickType for ${allVariants.length}/${shopifySkus.size} SKUs in database:`);
    console.log(`   - ${regular.length} Regular SKUs`);
    console.log(`   - ${pickAndPack.length} Pick and Pack SKUs`);

    if (allVariants.length < shopifySkus.size) {
      const missing = shopifySkus.size - allVariants.length;
      console.log(`   - ${missing} SKUs from Shopify not found in database (will be skipped)\n`);
    } else {
      console.log();
    }

    if (regular.length === 0 && pickAndPack.length === 0) {
      throw new Error("No SKUs found in database that match Shopify SKUs. Cannot generate configs.");
    }

    if (regular.length === 0) {
      console.warn("⚠️  Warning: No Regular SKUs found. Regular-only orders will fail.");
    }

    if (pickAndPack.length === 0) {
      console.warn("⚠️  Warning: No Pick and Pack SKUs found. Pnp-only orders will fail.");
    }

    return {
      regular,
      pickAndPack,
      all: allVariants,
    };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Load customers from config file
 */
function loadCustomers(): Customer[] {
  const customersPath = join(process.cwd(), "config", "customers.json");
  const customersData = JSON.parse(readFileSync(customersPath, "utf-8"));
  const canadianCustomers = customersData.customers.filter((c: Customer) => c.region === "CA");

  if (canadianCustomers.length === 0) {
    throw new Error("No Canadian customers found in config/customers.json");
  }

  console.log(`✅ Loaded ${canadianCustomers.length} Canadian customers\n`);
  return canadianCustomers;
}

/**
 * Get random element from array
 */
function randomElement<T>(array: T[], rng: SeededRNG): T {
  if (array.length === 0) {
    throw new Error("Cannot select random element from empty array");
  }
  return array[rng.randomInt(0, array.length)];
}

/**
 * Get random elements from array (without replacement)
 */
function randomElements<T>(array: T[], count: number, rng: SeededRNG): T[] {
  if (count > array.length) {
    throw new Error(`Cannot select ${count} elements from array of length ${array.length}`);
  }
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.randomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

/**
 * Generate a small order (1-5 items, quantity 1-2)
 */
function generateSmallOrder(
  catalog: SKUCatalog,
  customers: Customer[],
  orderType: "regular-only" | "pnp-only" | "mixed",
  itemCount: 1 | 2 | 3 | 4 | 5,
  rng: SeededRNG,
): SeedConfig["orders"][0] {
  const customer = randomElement(customers, rng);
  let lineItems: Array<{ sku: string; quantity: number; pickType: "Regular" | "Pick and Pack" }> = [];

  // Quantity is almost always 1, occasionally 2
  const quantity = rng.random() < 0.9 ? 1 : 2;

  if (orderType === "regular-only") {
    if (catalog.regular.length === 0) {
      throw new Error("Cannot create regular-only order: no Regular SKUs available");
    }
    const skus = randomElements(catalog.regular, itemCount, rng);
    lineItems = skus.map((sku) => ({
      sku: sku.sku,
      quantity,
      pickType: "Regular" as const,
    }));
  } else if (orderType === "pnp-only") {
    if (catalog.pickAndPack.length === 0) {
      throw new Error("Cannot create pnp-only order: no Pick and Pack SKUs available");
    }
    const skus = randomElements(catalog.pickAndPack, itemCount, rng);
    lineItems = skus.map((sku) => ({
      sku: sku.sku,
      quantity,
      pickType: "Pick and Pack" as const,
    }));
  } else {
    // Mixed order - split items between regular and pnp
    if (catalog.regular.length === 0 || catalog.pickAndPack.length === 0) {
      throw new Error("Cannot create mixed order: missing Regular or Pick and Pack SKUs");
    }

    if (itemCount === 1) {
      // Single item - randomly pick regular or pnp
      const pool = rng.random() < 0.5 ? catalog.regular : catalog.pickAndPack;
      const sku = randomElement(pool, rng);
      lineItems = [
        {
          sku: sku.sku,
          quantity,
          pickType: sku.pickType,
        },
      ];
    } else if (itemCount === 2) {
      // Two items - one regular, one pnp
      const regularSku = randomElement(catalog.regular, rng);
      const pnpSku = randomElement(catalog.pickAndPack, rng);
      lineItems = [
        {
          sku: regularSku.sku,
          quantity,
          pickType: "Regular" as const,
        },
        {
          sku: pnpSku.sku,
          quantity,
          pickType: "Pick and Pack" as const,
        },
      ];
    } else {
      // 3-5 items - distribute between regular and pnp
      // Prefer more regular items (60/40 split)
      const regularCount = Math.floor(itemCount * 0.6) || 1;
      const pnpCount = itemCount - regularCount;
      const regularSkus = randomElements(catalog.regular, regularCount, rng);
      const pnpSkus = randomElements(catalog.pickAndPack, pnpCount, rng);
      lineItems = [
        ...regularSkus.map((sku) => ({
          sku: sku.sku,
          quantity,
          pickType: "Regular" as const,
        })),
        ...pnpSkus.map((sku) => ({
          sku: sku.sku,
          quantity,
          pickType: "Pick and Pack" as const,
        })),
      ];
    }
  }

  return {
    orderType,
    customer: {
      name: customer.name,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      province: customer.province,
      postalCode: customer.postalCode,
    },
    lineItems,
  };
}

/**
 * Generate a single config file with small orders (1-5 items)
 */
function generateConfig(catalog: SKUCatalog, customers: Customer[], batchNumber: number, rng: SeededRNG): SeedConfig {
  const orders: SeedConfig["orders"] = [];

  // Distribution for small orders (1-5 items):
  // - 30% single-item orders (6 orders)
  // - 30% two-item orders (6 orders)
  // - 20% three-item orders (4 orders)
  // - 15% four-item orders (3 orders)
  // - 5% five-item orders (1 order)
  // - Order types: 40% regular-only, 40% pnp-only, 20% mixed

  const singleItemCount = 6;
  const twoItemCount = 6;
  const threeItemCount = 4;
  const fourItemCount = 3;
  const fiveItemCount = 1;

  // Generate single-item orders
  for (let i = 0; i < singleItemCount; i++) {
    const typeRand = rng.random();
    const orderType: "regular-only" | "pnp-only" | "mixed" =
      typeRand < 0.4 ? "regular-only" : typeRand < 0.8 ? "pnp-only" : "mixed";
    orders.push(generateSmallOrder(catalog, customers, orderType, 1, rng));
  }

  // Generate two-item orders
  for (let i = 0; i < twoItemCount; i++) {
    const typeRand = rng.random();
    const orderType: "regular-only" | "pnp-only" | "mixed" =
      typeRand < 0.4 ? "regular-only" : typeRand < 0.8 ? "pnp-only" : "mixed";
    orders.push(generateSmallOrder(catalog, customers, orderType, 2, rng));
  }

  // Generate three-item orders
  for (let i = 0; i < threeItemCount; i++) {
    const typeRand = rng.random();
    const orderType: "regular-only" | "pnp-only" | "mixed" =
      typeRand < 0.4 ? "regular-only" : typeRand < 0.8 ? "pnp-only" : "mixed";
    orders.push(generateSmallOrder(catalog, customers, orderType, 3, rng));
  }

  // Generate four-item orders
  for (let i = 0; i < fourItemCount; i++) {
    const typeRand = rng.random();
    const orderType: "regular-only" | "pnp-only" | "mixed" =
      typeRand < 0.4 ? "regular-only" : typeRand < 0.8 ? "pnp-only" : "mixed";
    orders.push(generateSmallOrder(catalog, customers, orderType, 4, rng));
  }

  // Generate five-item orders
  for (let i = 0; i < fiveItemCount; i++) {
    const typeRand = rng.random();
    const orderType: "regular-only" | "pnp-only" | "mixed" =
      typeRand < 0.4 ? "regular-only" : typeRand < 0.8 ? "pnp-only" : "mixed";
    orders.push(generateSmallOrder(catalog, customers, orderType, 5, rng));
  }

  // Shuffle orders for variety using Fisher-Yates
  for (let i = orders.length - 1; i > 0; i--) {
    const j = rng.randomInt(0, i + 1);
    [orders[i], orders[j]] = [orders[j], orders[i]];
  }

  return {
    region: "CA",
    orders,
  };
}

/**
 * Validate a config using Zod schema and custom checks
 */
function validateConfig(
  config: SeedConfig,
  catalog: SKUCatalog,
  customers: Customer[],
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Zod schema validation (critical)
  const zodResult = seedConfigSchema.safeParse(config);
  if (!zodResult.success) {
    zodResult.error.errors.forEach((e) => {
      errors.push(`Schema validation: ${e.path.join(".")} - ${e.message}`);
    });
    return { valid: false, errors, warnings }; // Stop here if schema invalid
  }

  // 2. Custom validation checks
  if (config.orders.length !== 20) {
    errors.push(`Expected 20 orders, got ${config.orders.length}`);
  }

  // Check that orders are small (1-5 items)
  const itemCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, other: 0 };
  for (const order of config.orders) {
    const itemCount = order.lineItems.length;
    if (itemCount === 1) itemCounts[1]++;
    else if (itemCount === 2) itemCounts[2]++;
    else if (itemCount === 3) itemCounts[3]++;
    else if (itemCount === 4) itemCounts[4]++;
    else if (itemCount === 5) itemCounts[5]++;
    else itemCounts.other++;

    // Validate quantities are 1-2
    for (const item of order.lineItems) {
      if (item.quantity < 1 || item.quantity > 2) {
        warnings.push(`Order has quantity ${item.quantity} (expected 1-2 for small orders)`);
      }
    }

    // Validate SKUs
    for (const item of order.lineItems) {
      const variant = catalog.all.find((v) => v.sku === item.sku);
      if (!variant) {
        errors.push(`SKU ${item.sku} not found in catalog`);
      } else if (variant.pickType !== item.pickType) {
        errors.push(`SKU ${item.sku} pickType mismatch: expected ${variant.pickType}, got ${item.pickType}`);
      }
    }

    // Validate customer
    const customer = customers.find((c) => c.email === order.customer.email);
    if (!customer) {
      errors.push(`Customer ${order.customer.email} not found`);
    }
  }

  // Check distribution (warnings, not errors - allow some variance)
  if (itemCounts.other > 0) {
    warnings.push(`Found ${itemCounts.other} orders with more than 5 items (expected only 1-5 item orders)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(): { seed?: number; batches?: number } {
  const args = process.argv.slice(2);
  const result: { seed?: number; batches?: number } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--seed" && i + 1 < args.length) {
      const seed = parseInt(args[i + 1], 10);
      if (isNaN(seed)) {
        console.error("Error: --seed must be a number");
        process.exit(1);
      }
      result.seed = seed;
      i++; // Skip next argument
    } else if (args[i] === "--batches" && i + 1 < args.length) {
      const batches = parseInt(args[i + 1], 10);
      if (isNaN(batches) || batches < 1) {
        console.error("Error: --batches must be a positive number");
        process.exit(1);
      }
      result.batches = batches;
      i++; // Skip next argument
    }
  }

  return result;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const seed = args.seed ?? Math.floor(Math.random() * 2 ** 31);
  const batches = args.batches ?? 10;

  console.log("🚀 Starting small Canada order config generation (1-5 boxes)...");
  console.log(`   Focus: Small orders (1-5 items, quantity 1-2)`);
  if (args.seed !== undefined) {
    console.log(`   Using seed: ${seed} (deterministic mode)\n`);
  } else {
    console.log(`   Using random seed: ${seed}\n`);
  }
  console.log(`   Generating ${batches} config batches\n`);

  // Phase 1: Data Discovery
  console.log("=".repeat(60));
  console.log("PHASE 1: Data Discovery");
  console.log("=".repeat(60));

  // Fetch SKUs directly from Shopify, then get pickType from database
  const catalog = await fetchShopifySkusWithPickTypes("CA");
  const customers = loadCustomers();

  // Phase 2: Generate Configs
  console.log("=".repeat(60));
  console.log("PHASE 2: Generating Config Files");
  console.log("=".repeat(60));

  const configs: Array<{
    batchNumber: number;
    config: SeedConfig;
    validation: { valid: boolean; errors: string[]; warnings: string[] };
  }> = [];

  for (let i = 1; i <= batches; i++) {
    console.log(`\n📝 Generating config batch ${i.toString().padStart(2, "0")}...`);
    // Use different seed for each batch to ensure variety
    const batchRng = new SeededRNG(seed + i);
    const config = generateConfig(catalog, customers, i, batchRng);
    const validation = validateConfig(config, catalog, customers);

    if (!validation.valid) {
      console.log(`   ❌ Validation errors:`);
      validation.errors.forEach((err) => console.log(`      - ${err}`));
    } else if (validation.warnings.length > 0) {
      console.log(`   ⚠️  Validation warnings:`);
      validation.warnings.forEach((warn) => console.log(`      - ${warn}`));
    } else {
      console.log(`   ✅ Config valid`);
    }

    configs.push({ batchNumber: i, config, validation });
  }

  // Phase 3: Save Files
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 3: Saving Config Files");
  console.log("=".repeat(60));

  const configDir = join(process.cwd(), "config");

  for (const { batchNumber, config } of configs) {
    const filename = `canada-orders-1to5-boxes-batch-${batchNumber.toString().padStart(2, "0")}.json`;
    const filepath = join(configDir, filename);
    writeFileSync(filepath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    console.log(`✅ Saved ${filename}`);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`✅ Generated ${batches} config files`);
  console.log(`✅ Total orders: ${configs.reduce((sum, c) => sum + c.config.orders.length, 0)}`);
  console.log(`✅ Configs saved to: ${configDir}`);
  console.log(`✅ All orders are small (1-5 items, quantity 1-2)`);
  if (args.seed !== undefined) {
    console.log(`✅ Seed used: ${seed} (re-run with --seed ${seed} to reproduce)\n`);
  } else {
    console.log(`✅ Random seed used: ${seed} (re-run with --seed ${seed} to reproduce)\n`);
  }
}

main().catch((error) => {
  console.error("❌ Error:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
