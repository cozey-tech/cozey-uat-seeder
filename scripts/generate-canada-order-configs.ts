#!/usr/bin/env tsx

/**
 * Generate 20 seed config files for Canadian orders
 * Each config contains 20 orders with diverse types, sizes, and complexities
 */

import { config } from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { initializeEnvConfig } from "../src/config/env";
import { ConfigDataRepository } from "../src/repositories/ConfigDataRepository";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SeedConfig } from "../src/shared/validation/seedConfigSchema";
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

interface HistoricalOrder {
  orderNumber: string;
  lineItems: Array<{ sku: string; quantity: number }>;
  itemCount: number;
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

const ORDER_SIZES: OrderSize[] = [
  { type: "small", minItems: 1, maxItems: 2 },
  { type: "medium", minItems: 3, maxItems: 5 },
  { type: "large", minItems: 6, maxItems: 10 },
  { type: "extra-large", minItems: 11, maxItems: 20 },
];

const ORDER_TYPE_DISTRIBUTION = {
  "regular-only": 7,
  "pnp-only": 7,
  mixed: 6,
};

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
 * Query Shopify for historical orders
 */
async function queryShopifyOrders(limit: number = 200): Promise<HistoricalOrder[]> {
  const envConfig = await initializeEnvConfig();
  const client = createAdminApiClient({
    storeDomain: envConfig.SHOPIFY_STORE_DOMAIN,
    apiVersion: envConfig.SHOPIFY_API_VERSION,
    accessToken: envConfig.SHOPIFY_ACCESS_TOKEN,
  });

  console.log(`\n🔍 Querying Shopify for last ${limit} orders...\n`);

  const query = `
    query getRecentOrders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            name
            lineItems(first: 250) {
              edges {
                node {
                  sku
                  quantity
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await client.request(query, { variables: { first: limit } });
    const orders = response.data?.orders?.edges || [];

    const historicalOrders: HistoricalOrder[] = orders
      .map(
        (edge: {
          node: { name: string; lineItems: { edges: Array<{ node: { sku?: string; quantity: number } }> } };
        }) => {
          const order = edge.node;
          const lineItems = order.lineItems.edges
            .map((li) => li.node)
            .filter((li) => li.sku) // Filter out items without SKUs
            .map((li) => ({ sku: li.sku!, quantity: li.quantity }));

          return {
            orderNumber: order.name,
            lineItems,
            itemCount: lineItems.length,
          };
        },
      )
      .filter((order: HistoricalOrder) => order.lineItems.length > 0); // Only orders with SKUs

    console.log(`✅ Found ${historicalOrders.length} orders with SKUs\n`);

    // Analyze patterns
    const orderSizes = historicalOrders.map((o) => o.itemCount);
    const avgSize = orderSizes.reduce((a, b) => a + b, 0) / orderSizes.length;
    const maxSize = Math.max(...orderSizes);
    const minSize = Math.min(...orderSizes);

    console.log(`📊 Order size analysis:`);
    console.log(`   - Average: ${avgSize.toFixed(1)} items`);
    console.log(`   - Range: ${minSize} - ${maxSize} items\n`);

    return historicalOrders;
  } catch (error) {
    console.error("⚠️  Failed to query Shopify orders:", error instanceof Error ? error.message : String(error));
    console.log("   Continuing without historical order data...\n");
    return [];
  }
}

/**
 * Load customers from config file
 */
function loadCustomers(): Customer[] {
  const customersPath = join(process.cwd(), "config", "customers.json");
  const customersData = JSON.parse(readFileSync(customersPath, "utf-8"));
  const canadianCustomers = customersData.customers.filter((c: Customer) => c.region === "CA");
  console.log(`✅ Loaded ${canadianCustomers.length} Canadian customers\n`);
  return canadianCustomers;
}

/**
 * Get random element from array
 */
function randomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Get random elements from array (without replacement)
 */
function randomElements<T>(array: T[], count: number): T[] {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, array.length));
}

/**
 * Generate quantity based on distribution
 */
function generateQuantity(): number {
  const rand = Math.random();
  if (rand < 0.7) return Math.floor(Math.random() * 2) + 1; // 70%: 1-2
  if (rand < 0.9) return Math.floor(Math.random() * 3) + 3; // 20%: 3-5
  if (rand < 0.98) return Math.floor(Math.random() * 5) + 6; // 8%: 6-10
  return Math.floor(Math.random() * 10) + 10; // 2%: 10-20
}

/**
 * Generate a "weird" order
 */
function generateWeirdOrder(
  catalog: SKUCatalog,
  customers: Customer[],
  orderType: "regular-only" | "pnp-only" | "mixed",
): SeedConfig["orders"][0] {
  const customer = randomElement(customers);
  const weirdType = Math.random();

  if (weirdType < 0.4) {
    // Bulk quantity order (single item, high quantity)
    const skuPool =
      orderType === "regular-only"
        ? catalog.regular
        : orderType === "pnp-only"
          ? catalog.pickAndPack
          : [...catalog.regular, ...catalog.pickAndPack];
    const sku = randomElement(skuPool);
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
          quantity: Math.floor(Math.random() * 15) + 10, // 10-25
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
    const uniqueSkus = randomElements(skuPool, Math.min(20, skuPool.length));
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
        quantity: generateQuantity(),
        pickType: sku.pickType,
      })),
    };
  } else {
    // Unusual combination (mix of kits, accessories, regular items)
    const regularSkus = randomElements(catalog.regular, Math.floor(Math.random() * 5) + 3);
    const pnpSkus = randomElements(catalog.pickAndPack, Math.floor(Math.random() * 5) + 2);
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
          quantity: generateQuantity(),
          pickType: sku.pickType as "Regular",
        })),
        ...pnpSkus.map((sku) => ({
          sku: sku.sku,
          quantity: generateQuantity(),
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
): SeedConfig["orders"][0] {
  const customer = randomElement(customers);
  const itemCount = Math.floor(Math.random() * (size.maxItems - size.minItems + 1)) + size.minItems;

  let lineItems: Array<{ sku: string; quantity: number; pickType: "Regular" | "Pick and Pack" }> = [];

  if (orderType === "regular-only") {
    const skus = randomElements(catalog.regular, itemCount);
    lineItems = skus.map((sku) => ({
      sku: sku.sku,
      quantity: generateQuantity(),
      pickType: "Regular" as const,
    }));
  } else if (orderType === "pnp-only") {
    const skus = randomElements(catalog.pickAndPack, itemCount);
    lineItems = skus.map((sku) => ({
      sku: sku.sku,
      quantity: generateQuantity(),
      pickType: "Pick and Pack" as const,
    }));
  } else {
    // Mixed order
    const regularCount = Math.floor(itemCount / 2);
    const pnpCount = itemCount - regularCount;
    const regularSkus = randomElements(catalog.regular, regularCount);
    const pnpSkus = randomElements(catalog.pickAndPack, pnpCount);

    lineItems = [
      ...regularSkus.map((sku) => ({
        sku: sku.sku,
        quantity: generateQuantity(),
        pickType: "Regular" as const,
      })),
      ...pnpSkus.map((sku) => ({
        sku: sku.sku,
        quantity: generateQuantity(),
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
function generateConfig(catalog: SKUCatalog, customers: Customer[], _batchNumber: number): SeedConfig {
  const orders: SeedConfig["orders"] = [];
  const weirdOrderCount = 2 + Math.floor(Math.random() * 2); // 2-3 weird orders

  // Build order plan
  const orderPlan: Array<{ type: "regular-only" | "pnp-only" | "mixed"; size: OrderSize; isWeird: boolean }> = [];

  // Add normal orders
  for (const [type, count] of Object.entries(ORDER_TYPE_DISTRIBUTION)) {
    const orderType = type as "regular-only" | "pnp-only" | "mixed";

    // Distribute sizes for this order type
    for (let i = 0; i < count; i++) {
      // Pick a size based on distribution
      const sizeRand = Math.random();
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

  // Replace some orders with weird ones
  for (let i = 0; i < weirdOrderCount; i++) {
    const index = Math.floor(Math.random() * orderPlan.length);
    const order = orderPlan[index];
    orderPlan[index] = { ...order, isWeird: true };
  }

  // Generate orders
  for (const plan of orderPlan) {
    if (plan.isWeird) {
      orders.push(generateWeirdOrder(catalog, customers, plan.type));
    } else {
      orders.push(generateOrder(catalog, customers, plan.type, plan.size));
    }
  }

  // Shuffle orders for variety
  orders.sort(() => Math.random() - 0.5);

  return {
    region: "CA",
    orders,
  };
}

/**
 * Validate a config
 */
function validateConfig(
  config: SeedConfig,
  catalog: SKUCatalog,
  customers: Customer[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check order count
  if (config.orders.length !== 20) {
    errors.push(`Expected 20 orders, got ${config.orders.length}`);
  }

  // Check order type distribution
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

  // Check distributions (allow some variance)
  if (Math.abs(typeCounts["regular-only"] - 7) > 1) {
    errors.push(`Regular-only count ${typeCounts["regular-only"]} is too far from target 7`);
  }
  if (Math.abs(typeCounts["pnp-only"] - 7) > 1) {
    errors.push(`Pnp-only count ${typeCounts["pnp-only"]} is too far from target 7`);
  }
  if (Math.abs(typeCounts.mixed - 6) > 1) {
    errors.push(`Mixed count ${typeCounts.mixed} is too far from target 6`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log("🚀 Starting Canada order config generation...\n");

  // Phase 1: Data Discovery
  console.log("=".repeat(60));
  console.log("PHASE 1: Data Discovery");
  console.log("=".repeat(60));

  const catalog = await queryDatabaseSKUs("CA");
  await queryShopifyOrders(200); // Query for analysis, but not used directly in generation
  const customers = loadCustomers();

  if (catalog.regular.length === 0 && catalog.pickAndPack.length === 0) {
    console.error("❌ No SKUs found in database. Cannot generate configs.");
    process.exit(1);
  }

  // Phase 2: Generate Configs
  console.log("=".repeat(60));
  console.log("PHASE 2: Generating Config Files");
  console.log("=".repeat(60));

  const configs: Array<{ batchNumber: number; config: SeedConfig; validation: { valid: boolean; errors: string[] } }> =
    [];

  for (let i = 1; i <= 20; i++) {
    console.log(`\n📝 Generating config batch ${i.toString().padStart(2, "0")}...`);
    const config = generateConfig(catalog, customers, i);
    const validation = validateConfig(config, catalog, customers);

    if (!validation.valid) {
      console.log(`   ⚠️  Validation warnings:`);
      validation.errors.forEach((err) => console.log(`      - ${err}`));
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
  console.log(`✅ Configs saved to: ${configDir}\n`);
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
