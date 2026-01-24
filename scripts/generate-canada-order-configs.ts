#!/usr/bin/env tsx

/**
 * Generate 20 seed config files for Canadian orders
 * Each config contains 20 orders with diverse types, sizes, and complexities
 *
 * Usage:
 *   npx tsx scripts/generate-canada-order-configs.ts [--seed <number>]
 *
 * Options:
 *   --seed <number>  Optional seed for deterministic output (default: random)
 *
 * Examples:
 *   npx tsx scripts/generate-canada-order-configs.ts
 *   npx tsx scripts/generate-canada-order-configs.ts --seed 12345
 */

import { config } from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";
import { ConfigDataRepository } from "../src/repositories/ConfigDataRepository";
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
  region: string;
  locationId: string;
}

interface SKUCatalog {
  regular: Variant[];
  pickAndPack: Variant[];
  all: Variant[];
}

interface OrderSize {
  type: "small" | "medium" | "large" | "extra-large";
  minItems: number;
  maxItems: number;
}

interface DistributionConfig {
  orderType: {
    "regular-only": number;
    "pnp-only": number;
    mixed: number;
  };
  orderSize: {
    small: number;
    medium: number;
    large: number;
    "extra-large": number;
  };
  quantity: {
    low: number; // 1-2
    medium: number; // 3-5
    high: number; // 6-10
    bulk: number; // 10+
  };
}

const ORDER_SIZES: OrderSize[] = [
  { type: "small", minItems: 1, maxItems: 2 },
  { type: "medium", minItems: 3, maxItems: 5 },
  { type: "large", minItems: 6, maxItems: 10 },
  { type: "extra-large", minItems: 11, maxItems: 20 },
];

const DEFAULT_DISTRIBUTION: DistributionConfig = {
  orderType: {
    "regular-only": 7,
    "pnp-only": 7,
    mixed: 6,
  },
  orderSize: {
    small: 2,
    medium: 10,
    large: 6,
    "extra-large": 2,
  },
  quantity: {
    low: 0.7, // 70%: 1-2
    medium: 0.2, // 20%: 3-5
    high: 0.08, // 8%: 6-10
    bulk: 0.02, // 2%: 10-20
  },
};

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
 * Query database for all available SKUs
 */
async function queryDatabaseSKUs(region: string = "CA"): Promise<SKUCatalog> {
  const prisma = new PrismaClient();
  const repository = new ConfigDataRepository(prisma);

  try {
    console.log(`\n🔍 Querying database for available SKUs in region: ${region}\n`);
    const variants = await repository.getAvailableVariants(region);

    const regular = variants.filter((v) => v.pickType === "Regular");
    const pickAndPack = variants.filter((v) => v.pickType === "Pick and Pack");

    console.log(`✅ Found ${variants.length} total variants:`);
    console.log(`   - ${regular.length} Regular SKUs`);
    console.log(`   - ${pickAndPack.length} Pick and Pack SKUs\n`);

    if (regular.length === 0 && pickAndPack.length === 0) {
      throw new Error("No SKUs found in database. Cannot generate configs.");
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
      all: variants,
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
 * Get random element from array (with error handling)
 */
function randomElement<T>(array: T[], rng: SeededRNG): T {
  if (array.length === 0) {
    throw new Error("Cannot select random element from empty array");
  }
  return array[rng.randomInt(0, array.length)];
}

/**
 * Get random elements from array using Fisher-Yates shuffle (without replacement)
 * Efficient for large arrays when count << array.length
 */
function randomElements<T>(array: T[], count: number, rng: SeededRNG): T[] {
  if (array.length === 0) {
    throw new Error("Cannot select random elements from empty array");
  }

  const actualCount = Math.min(count, array.length);
  if (actualCount === 0) {
    return [];
  }

  // Use reservoir sampling for large arrays (more efficient)
  if (actualCount < array.length / 10) {
    const selected = new Set<number>();
    while (selected.size < actualCount) {
      selected.add(rng.randomInt(0, array.length));
    }
    return Array.from(selected).map((i) => array[i]);
  }

  // Use Fisher-Yates shuffle for smaller selections
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > shuffled.length - actualCount - 1; i--) {
    const j = rng.randomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(-actualCount);
}

/**
 * Generate quantity based on distribution
 */
function generateQuantity(rng: SeededRNG, distribution: DistributionConfig["quantity"]): number {
  const rand = rng.random();
  if (rand < distribution.low) {
    return rng.randomInt(1, 3); // 1-2
  } else if (rand < distribution.low + distribution.medium) {
    return rng.randomInt(3, 6); // 3-5
  } else if (rand < distribution.low + distribution.medium + distribution.high) {
    return rng.randomInt(6, 11); // 6-10
  } else {
    return rng.randomInt(10, 21); // 10-20
  }
}

/**
 * Generate a "weird" order
 */
function generateWeirdOrder(
  catalog: SKUCatalog,
  customers: Customer[],
  orderType: "regular-only" | "pnp-only" | "mixed",
  rng: SeededRNG,
  distribution: DistributionConfig["quantity"],
): SeedConfig["orders"][0] {
  const customer = randomElement(customers, rng);
  const weirdType = rng.random();

  if (weirdType < 0.4) {
    // Bulk quantity order (single item, high quantity)
    const skuPool =
      orderType === "regular-only"
        ? catalog.regular
        : orderType === "pnp-only"
          ? catalog.pickAndPack
          : [...catalog.regular, ...catalog.pickAndPack];

    if (skuPool.length === 0) {
      throw new Error(`No SKUs available for ${orderType} order type`);
    }

    const sku = randomElement(skuPool, rng);
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
      lineItems: [
        {
          sku: sku.sku,
          quantity: rng.randomInt(10, 26), // 10-25
          pickType: sku.pickType,
        },
      ],
    };
  } else if (weirdType < 0.7) {
    // Many different SKUs (15+ unique items)
    const skuPool =
      orderType === "regular-only"
        ? catalog.regular
        : orderType === "pnp-only"
          ? catalog.pickAndPack
          : [...catalog.regular, ...catalog.pickAndPack];

    if (skuPool.length === 0) {
      throw new Error(`No SKUs available for ${orderType} order type`);
    }

    const uniqueSkus = randomElements(skuPool, Math.min(20, skuPool.length), rng);
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
      lineItems: uniqueSkus.map((sku) => ({
        sku: sku.sku,
        quantity: generateQuantity(rng, distribution),
        pickType: sku.pickType,
      })),
    };
  } else {
    // Unusual combination (mix of kits, accessories, regular items)
    if (catalog.regular.length === 0 || catalog.pickAndPack.length === 0) {
      throw new Error("Cannot create mixed order: missing Regular or Pick and Pack SKUs");
    }

    const regularSkus = randomElements(catalog.regular, rng.randomInt(3, 8), rng);
    const pnpSkus = randomElements(catalog.pickAndPack, rng.randomInt(2, 7), rng);
    return {
      orderType: "mixed",
      customer: {
        name: customer.name,
        email: customer.email,
        address: customer.address,
        city: customer.city,
        province: customer.province,
        postalCode: customer.postalCode,
      },
      lineItems: [
        ...regularSkus.map((sku) => ({
          sku: sku.sku,
          quantity: generateQuantity(rng, distribution),
          pickType: sku.pickType as "Regular",
        })),
        ...pnpSkus.map((sku) => ({
          sku: sku.sku,
          quantity: generateQuantity(rng, distribution),
          pickType: sku.pickType as "Pick and Pack",
        })),
      ],
    };
  }
}

/**
 * Generate a normal order
 */
function generateOrder(
  catalog: SKUCatalog,
  customers: Customer[],
  orderType: "regular-only" | "pnp-only" | "mixed",
  size: OrderSize,
  rng: SeededRNG,
  distribution: DistributionConfig["quantity"],
): SeedConfig["orders"][0] {
  const customer = randomElement(customers, rng);
  const itemCount = rng.randomInt(size.minItems, size.maxItems + 1);

  let lineItems: Array<{ sku: string; quantity: number; pickType: "Regular" | "Pick and Pack" }> = [];

  if (orderType === "regular-only") {
    if (catalog.regular.length === 0) {
      throw new Error("Cannot create regular-only order: no Regular SKUs available");
    }
    const skus = randomElements(catalog.regular, itemCount, rng);
    lineItems = skus.map((sku) => ({
      sku: sku.sku,
      quantity: generateQuantity(rng, distribution),
      pickType: "Regular" as const,
    }));
  } else if (orderType === "pnp-only") {
    if (catalog.pickAndPack.length === 0) {
      throw new Error("Cannot create pnp-only order: no Pick and Pack SKUs available");
    }
    const skus = randomElements(catalog.pickAndPack, itemCount, rng);
    lineItems = skus.map((sku) => ({
      sku: sku.sku,
      quantity: generateQuantity(rng, distribution),
      pickType: "Pick and Pack" as const,
    }));
  } else {
    // Mixed order
    if (catalog.regular.length === 0 || catalog.pickAndPack.length === 0) {
      throw new Error("Cannot create mixed order: missing Regular or Pick and Pack SKUs");
    }

    const regularCount = Math.floor(itemCount / 2);
    const pnpCount = itemCount - regularCount;
    const regularSkus = randomElements(catalog.regular, regularCount, rng);
    const pnpSkus = randomElements(catalog.pickAndPack, pnpCount, rng);

    lineItems = [
      ...regularSkus.map((sku) => ({
        sku: sku.sku,
        quantity: generateQuantity(rng, distribution),
        pickType: "Regular" as const,
      })),
      ...pnpSkus.map((sku) => ({
        sku: sku.sku,
        quantity: generateQuantity(rng, distribution),
        pickType: "Pick and Pack" as const,
      })),
    ];
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
 * Generate a single config file
 */
function generateConfig(
  catalog: SKUCatalog,
  customers: Customer[],
  batchNumber: number,
  rng: SeededRNG,
  distribution: DistributionConfig,
): SeedConfig {
  const orders: SeedConfig["orders"] = [];
  const weirdOrderCount = rng.randomInt(2, 4); // 2-3 weird orders

  // Build order plan
  const orderPlan: Array<{ type: "regular-only" | "pnp-only" | "mixed"; size: OrderSize; isWeird: boolean }> = [];

  // Add normal orders
  for (const [type, count] of Object.entries(distribution.orderType)) {
    const orderType = type as "regular-only" | "pnp-only" | "mixed";

    // Distribute sizes for this order type
    for (let i = 0; i < count; i++) {
      // Pick a size based on distribution
      const sizeRand = rng.random();
      let size: OrderSize;
      if (sizeRand < 0.1)
        size = ORDER_SIZES[0]; // 10% small
      else if (sizeRand < 0.6)
        size = ORDER_SIZES[1]; // 50% medium
      else if (sizeRand < 0.9)
        size = ORDER_SIZES[2]; // 30% large
      else size = ORDER_SIZES[3]; // 10% extra-large

      orderPlan.push({ type: orderType, size, isWeird: false });
    }
  }

  if (orderPlan.length === 0) {
    throw new Error("Order plan is empty. Check distribution configuration.");
  }

  // Replace some orders with weird ones
  for (let i = 0; i < weirdOrderCount; i++) {
    const index = rng.randomInt(0, orderPlan.length);
    const order = orderPlan[index];
    orderPlan[index] = { ...order, isWeird: true };
  }

  // Generate orders
  for (const plan of orderPlan) {
    if (plan.isWeird) {
      orders.push(generateWeirdOrder(catalog, customers, plan.type, rng, distribution.quantity));
    } else {
      orders.push(generateOrder(catalog, customers, plan.type, plan.size, rng, distribution.quantity));
    }
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

  // 2. Custom validation checks (supplementary)
  if (config.orders.length !== 20) {
    errors.push(`Expected 20 orders, got ${config.orders.length}`);
  }

  const typeCounts = { "regular-only": 0, "pnp-only": 0, mixed: 0 };
  const sizeCounts = { small: 0, medium: 0, large: 0, "extra-large": 0 };

  for (const order of config.orders) {
    if (order.orderType) {
      typeCounts[order.orderType]++;
    }

    const itemCount = order.lineItems.length;
    if (itemCount <= 2) sizeCounts.small++;
    else if (itemCount <= 5) sizeCounts.medium++;
    else if (itemCount <= 10) sizeCounts.large++;
    else sizeCounts["extra-large"]++;

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

  // Check distributions (warnings, not errors - allow some variance)
  if (Math.abs(typeCounts["regular-only"] - DEFAULT_DISTRIBUTION.orderType["regular-only"]) > 1) {
    warnings.push(
      `Regular-only count ${typeCounts["regular-only"]} is too far from target ${DEFAULT_DISTRIBUTION.orderType["regular-only"]}`,
    );
  }
  if (Math.abs(typeCounts["pnp-only"] - DEFAULT_DISTRIBUTION.orderType["pnp-only"]) > 1) {
    warnings.push(
      `Pnp-only count ${typeCounts["pnp-only"]} is too far from target ${DEFAULT_DISTRIBUTION.orderType["pnp-only"]}`,
    );
  }
  if (Math.abs(typeCounts.mixed - DEFAULT_DISTRIBUTION.orderType.mixed) > 1) {
    warnings.push(`Mixed count ${typeCounts.mixed} is too far from target ${DEFAULT_DISTRIBUTION.orderType.mixed}`);
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
function parseArgs(): { seed?: number } {
  const args = process.argv.slice(2);
  const result: { seed?: number } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--seed" && i + 1 < args.length) {
      const seed = parseInt(args[i + 1], 10);
      if (isNaN(seed)) {
        console.error("Error: --seed must be a number");
        process.exit(1);
      }
      result.seed = seed;
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

  console.log("🚀 Starting Canada order config generation...");
  if (args.seed !== undefined) {
    console.log(`   Using seed: ${seed} (deterministic mode)\n`);
  } else {
    console.log(`   Using random seed: ${seed}\n`);
  }

  // Phase 1: Data Discovery
  console.log("=".repeat(60));
  console.log("PHASE 1: Data Discovery");
  console.log("=".repeat(60));

  const catalog = await queryDatabaseSKUs("CA");
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

  for (let i = 1; i <= 20; i++) {
    console.log(`\n📝 Generating config batch ${i.toString().padStart(2, "0")}...`);
    // Use different seed for each batch to ensure variety
    const batchRng = new SeededRNG(seed + i);
    const config = generateConfig(catalog, customers, i, batchRng, DEFAULT_DISTRIBUTION);
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
    const filename = `canada-orders-batch-${batchNumber.toString().padStart(2, "0")}.json`;
    const filepath = join(configDir, filename);
    writeFileSync(filepath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    console.log(`✅ Saved ${filename}`);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`✅ Generated 20 config files`);
  console.log(`✅ Total orders: ${configs.reduce((sum, c) => sum + c.config.orders.length, 0)}`);
  console.log(`✅ Configs saved to: ${configDir}`);
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
