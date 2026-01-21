/**
 * Compare a Shopify order with its corresponding WMS order
 * to understand the SKU mapping
 */

import { config } from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";

// Load .env files
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

async function compareShopifyWmsOrder(shopifyOrderNumber: string, region: string = "CA"): Promise<void> {
  const prisma = new PrismaClient();

  try {
    console.log(`\n🔍 Searching for WMS orders with Shopify order number: ${shopifyOrderNumber}\n`);

    // Find WMS order by shopifyOrderNumber
    const wmsOrders = await prisma.order.findMany({
      where: {
        shopifyOrderNumber: shopifyOrderNumber,
        region,
      },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderNumber: true,
        variantOrder: {
          select: {
            lineItemId: true,
            quantity: true,
            variant: {
              select: {
                sku: true,
                shopifyIds: true,
                modelName: true,
                colorId: true,
              },
            },
          },
        },
      },
    });

    if (wmsOrders.length === 0) {
      console.log(`❌ No WMS orders found with Shopify order number: ${shopifyOrderNumber}`);
      console.log("\nSearching for recent seed orders...\n");

      // Search for recent seed orders by sourceName
      const recentOrders = await prisma.order.findMany({
        where: {
          region,
          sourceName: "wms_seed",
        },
        select: {
          id: true,
          shopifyOrderId: true,
          shopifyOrderNumber: true,
          variantOrder: {
            select: {
              lineItemId: true,
              quantity: true,
              variant: {
                select: {
                  sku: true,
                  shopifyIds: true,
                },
              },
            },
          },
        },
        take: 5,
        orderBy: {
          createdAt: "desc",
        },
      });

      console.log(`Found ${recentOrders.length} recent WMS seed orders:\n`);
      for (const order of recentOrders) {
        console.log(`Order ID: ${order.id}`);
        console.log(`  Shopify Order #: ${order.shopifyOrderNumber}`);
        console.log(`  Shopify Order ID: ${order.shopifyOrderId}`);
        console.log(`  Line Items:`);
        for (const vo of order.variantOrder) {
          console.log(`    - SKU: ${vo.variant.sku} (qty: ${vo.quantity})`);
          console.log(`      Shopify IDs: ${JSON.stringify(vo.variant.shopifyIds)}`);
        }
        console.log("");
      }
      return;
    }

    console.log(`✅ Found ${wmsOrders.length} WMS order(s):\n`);

    for (const order of wmsOrders) {
      console.log(`WMS Order ID: ${order.id}`);
      console.log(`Shopify Order ID: ${order.shopifyOrderId}`);
      console.log(`Shopify Order #: ${order.shopifyOrderNumber}`);
      console.log(`\nLine Items:`);
      for (const vo of order.variantOrder) {
        console.log(`  SKU: ${vo.variant.sku}`);
        console.log(`    Quantity: ${vo.quantity}`);
        console.log(`    Shopify IDs: ${JSON.stringify(vo.variant.shopifyIds)}`);
        console.log(`    Model: ${vo.variant.modelName}`);
        console.log(`    Color: ${vo.variant.colorId}`);
        console.log("");
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Get order number from command line
const shopifyOrderNumber = process.argv[2];
const region = process.argv[3] || "CA";

if (!shopifyOrderNumber) {
  console.error("Usage: npx tsx scripts/compare-shopify-wms-order.ts <shopify-order-number> [region]");
  console.error("Example: npx tsx scripts/compare-shopify-wms-order.ts #5008 CA");
  process.exit(1);
}

compareShopifyWmsOrder(shopifyOrderNumber, region).catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
