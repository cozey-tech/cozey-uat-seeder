/**
 * Inspect what shopifyIds look like in the WMS database
 */

import { config } from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";

// Load .env files
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

async function inspectShopifyIds(region: string = "CA"): Promise<void> {
  const prisma = new PrismaClient();

  try {
    console.log(`\n🔍 Inspecting shopifyIds in WMS database (region: ${region})\n`);

    // Get variants with Shopify IDs
    const variants = await prisma.variant.findMany({
      where: {
        region,
        shopifyIds: {
          isEmpty: false,
        },
      },
      select: {
        id: true,
        sku: true,
        modelName: true,
        shopifyIds: true,
      },
      take: 20,
    });

    console.log(`Found ${variants.length} variants with shopifyIds:\n`);

    for (const variant of variants) {
      console.log(`SKU: ${variant.sku}`);
      console.log(`  Model: ${variant.modelName}`);
      console.log(`  Shopify IDs: ${JSON.stringify(variant.shopifyIds)}`);
      console.log("");
    }

    // Also check if the SKU 42023-101-3x1 has shopifyIds
    console.log("\n=== Checking specific SKU: 42023-101-3x1 ===\n");

    const specificVariant = await prisma.variant.findFirst({
      where: {
        region,
        sku: "42023-101-3x1",
      },
      select: {
        id: true,
        sku: true,
        modelName: true,
        shopifyIds: true,
      },
    });

    if (specificVariant) {
      console.log("✅ Found variant:");
      console.log(`  SKU: ${specificVariant.sku}`);
      console.log(`  Model: ${specificVariant.modelName}`);
      console.log(`  Shopify IDs: ${JSON.stringify(specificVariant.shopifyIds)}`);
    } else {
      console.log("❌ SKU not found in database");
    }
  } finally {
    await prisma.$disconnect();
  }
}

const region = process.argv[2] || "CA";
inspectShopifyIds(region).catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
