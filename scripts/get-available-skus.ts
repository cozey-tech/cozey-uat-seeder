#!/usr/bin/env node

/**
 * Script to query the database for available SKUs and their pickTypes
 * Useful for updating order templates with real SKUs from the database
 */

import { config } from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";

// Load .env first, then .env.local (which will override .env values)
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

async function getAvailableSkus(region: string = "CA") {
  const prisma = new PrismaClient();

  try {
    console.log(`\n🔍 Querying database for available SKUs in region: ${region}\n`);

    // Get variants with Shopify IDs (required for order creation)
    const variants = await prisma.variant.findMany({
      where: {
        region,
        disabled: false,
        shopifyIds: {
          isEmpty: false,
        },
      },
      select: {
        id: true,
        sku: true,
        modelName: true,
        colorId: true,
        description: true,
      },
      orderBy: [{ modelName: "asc" }, { colorId: "asc" }, { sku: "asc" }],
      take: 100, // Limit to first 100 for display
    });

    // Get variant parts to determine pickType
    const variantIds = variants.map((v) => v.id);
    const allVariantParts = await prisma.variantPart.findMany({
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
    const variantPartsByVariantId = new Map<string, typeof allVariantParts>();
    for (const vp of allVariantParts) {
      const existing = variantPartsByVariantId.get(vp.variantId) || [];
      existing.push(vp);
      variantPartsByVariantId.set(vp.variantId, existing);
    }

    // Get pickType for each variant
    const variantsWithPickType = variants.map((v) => {
      const variantParts = variantPartsByVariantId.get(v.id) || [];

      // Determine pickType from parts
      let pickType: "Regular" | "Pick and Pack" = "Regular";
      if (variantParts.length > 0) {
        const pickTypeCounts = new Map<string, number>();
        for (const vp of variantParts) {
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

      return {
        sku: v.sku,
        pickType,
        modelName: v.modelName,
        colorId: v.colorId,
        description: v.description,
      };
    });

    // Group by pickType
    const regularSkus = variantsWithPickType.filter((v) => v.pickType === "Regular");
    const pnpSkus = variantsWithPickType.filter((v) => v.pickType === "Pick and Pack");

    console.log(`✅ Found ${variantsWithPickType.length} available variants\n`);

    console.log("📦 Regular PickType SKUs:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    regularSkus.slice(0, 20).forEach((v) => {
      console.log(`  ${v.sku} - ${v.modelName} - ${v.colorId}`);
    });
    if (regularSkus.length > 20) {
      console.log(`  ... and ${regularSkus.length - 20} more`);
    }

    console.log("\n📦 Pick and Pack SKUs:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    pnpSkus.slice(0, 20).forEach((v) => {
      console.log(`  ${v.sku} - ${v.modelName} - ${v.colorId}`);
    });
    if (pnpSkus.length > 20) {
      console.log(`  ... and ${pnpSkus.length - 20} more`);
    }

    // Output JSON for easy template creation
    console.log("\n\n📋 Sample SKUs for templates (JSON):");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      JSON.stringify(
        {
          regular: regularSkus.slice(0, 5).map((v) => ({
            sku: v.sku,
            pickType: v.pickType,
            description: v.description,
          })),
          pickAndPack: pnpSkus.slice(0, 5).map((v) => ({
            sku: v.sku,
            pickType: v.pickType,
            description: v.description,
          })),
        },
        null,
        2,
      ),
    );

    return {
      regular: regularSkus,
      pickAndPack: pnpSkus,
      all: variantsWithPickType,
    };
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
const region = process.argv[2] || "CA";
getAvailableSkus(region).catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
