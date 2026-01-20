/**
 * Map Shopify variant IDs to WMS SKUs
 * Helps identify the correct WMS SKUs for order templates
 */

import { config } from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";

// Load .env files
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

interface ShopifyVariant {
  variantId: string;
  shopifySku: string;
  title: string;
}

async function mapShopifyToWmsSkus(shopifyVariants: ShopifyVariant[], region: string = "CA"): Promise<void> {
  const prisma = new PrismaClient();

  try {
    console.log(`\n🔍 Mapping ${shopifyVariants.length} Shopify variants to WMS SKUs (region: ${region})\n`);

    const results: Array<{
      shopifyVariantId: string;
      shopifySku: string;
      wmsSku: string | null;
      wmsVariantId: string | null;
      title: string;
      found: boolean;
    }> = [];

    for (const variant of shopifyVariants) {
      // Extract numeric ID from GID
      const numericId = variant.variantId.split("/").pop();

      if (!numericId) {
        results.push({
          shopifyVariantId: variant.variantId,
          shopifySku: variant.shopifySku,
          wmsSku: null,
          wmsVariantId: null,
          title: variant.title,
          found: false,
        });
        continue;
      }

      // Query WMS for variant with this Shopify ID
      const wmsVariant = await prisma.variant.findFirst({
        where: {
          region,
          shopifyIds: {
            has: numericId,
          },
        },
        select: {
          id: true,
          sku: true,
          modelName: true,
          colorId: true,
          description: true,
        },
      });

      if (wmsVariant) {
        results.push({
          shopifyVariantId: variant.variantId,
          shopifySku: variant.shopifySku,
          wmsSku: wmsVariant.sku,
          wmsVariantId: wmsVariant.id,
          title: variant.title,
          found: true,
        });
      } else {
        results.push({
          shopifyVariantId: variant.variantId,
          shopifySku: variant.shopifySku,
          wmsSku: null,
          wmsVariantId: null,
          title: variant.title,
          found: false,
        });
      }
    }

    // Print results
    console.log("=== Mapping Results ===\n");

    const found = results.filter((r) => r.found);
    const notFound = results.filter((r) => !r.found);

    if (found.length > 0) {
      console.log(`✅ Found ${found.length} mapping(s):\n`);
      for (const result of found) {
        console.log(`  ${result.title}`);
        console.log(`    Shopify SKU: ${result.shopifySku}`);
        console.log(`    WMS SKU:     ${result.wmsSku}`);
        console.log(`    WMS ID:      ${result.wmsVariantId}`);
        console.log("");
      }
    }

    if (notFound.length > 0) {
      console.log(`❌ Not found: ${notFound.length} variant(s):\n`);
      for (const result of notFound) {
        console.log(`  ${result.title}`);
        console.log(`    Shopify SKU: ${result.shopifySku}`);
        console.log(`    Shopify ID:  ${result.shopifyVariantId}`);
        console.log("");
      }
    }

    // Output JSON
    console.log("\n=== JSON Mapping ===\n");
    console.log(JSON.stringify(results, null, 2));

    return results;
  } finally {
    await prisma.$disconnect();
  }
}

// Test with Order 5008 variants
const testVariants: ShopifyVariant[] = [
  {
    variantId: "gid://shopify/ProductVariant/52420771217724",
    shopifySku: "34026-1-67-5x8F",
    title: "Cooper Rug & Runner - Rug / 5' x 8' / Granite",
  },
  {
    variantId: "gid://shopify/ProductVariant/52421055217980",
    shopifySku: "1+2035-0-SS-610",
    title: "Neptune - Sectional - Leaf",
  },
  {
    variantId: "gid://shopify/ProductVariant/52420989354300",
    shopifySku: "34018-1-65-3x5F",
    title: "Caleb Rug & Runner - Rug / 3' x 5' / Sand & Truffle",
  },
  {
    variantId: "gid://shopify/ProductVariant/46941384704316",
    shopifySku: "42023-101-3x1",
    title: "Altitude Wall Shelf & Cabinet - Shelf / Set of 3 / Oak",
  },
];

const region = process.argv[2] || "CA";
mapShopifyToWmsSkus(testVariants, region).catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
