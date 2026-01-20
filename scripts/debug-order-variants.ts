/**
 * Debug script to inspect Shopify order line item and variant data
 * Helps understand SKU mapping between Shopify and WMS
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { initializeEnvConfig } from "../src/config/env";

// Load .env files (same as main CLI)
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

async function debugOrderVariants(orderNumber: string): Promise<void> {
  const envConfig = await initializeEnvConfig();

  const client = createAdminApiClient({
    storeDomain: envConfig.SHOPIFY_STORE_DOMAIN,
    apiVersion: envConfig.SHOPIFY_API_VERSION,
    accessToken: envConfig.SHOPIFY_ACCESS_TOKEN,
  });

  const searchTerm = orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`;

  const query = `
    query getOrderByName($query: String!) {
      orders(first: 1, query: $query) {
        edges {
          node {
            id
            name
            lineItems(first: 250) {
              edges {
                node {
                  id
                  title
                  sku
                  quantity
                  variant {
                    id
                    sku
                    title
                    inventoryItem {
                      id
                      sku
                    }
                    product {
                      id
                      title
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await client.request(query, { variables: { query: `name:${searchTerm}` } });

    if (!response.data?.orders?.edges || response.data.orders.edges.length === 0) {
      console.error("Order not found");
      return;
    }

    const order = response.data.orders.edges[0].node;

    console.log(`\n=== Order ${order.name} Debug Info ===\n`);
    console.log(`Order ID: ${order.id}\n`);

    console.log("Line Items:\n");
    for (const edge of order.lineItems.edges) {
      const item = edge.node;
      console.log(`📦 ${item.title}`);
      console.log(`   Line Item SKU: ${item.sku || "N/A"}`);
      console.log(`   Quantity: ${item.quantity}`);
      console.log(`   Line Item ID: ${item.id}`);

      if (item.variant) {
        console.log(`   Variant ID: ${item.variant.id}`);
        console.log(`   Variant SKU: ${item.variant.sku || "N/A"}`);
        console.log(`   Variant Title: ${item.variant.title}`);

        if (item.variant.inventoryItem) {
          console.log(`   Inventory Item ID: ${item.variant.inventoryItem.id}`);
          console.log(`   Inventory Item SKU: ${item.variant.inventoryItem.sku || "N/A"}`);
        }

        if (item.variant.product) {
          console.log(`   Product ID: ${item.variant.product.id}`);
          console.log(`   Product Title: ${item.variant.product.title}`);
        }
      } else {
        console.log(`   ⚠️  No variant data available`);
      }

      console.log("");
    }

    // Output full JSON for inspection
    console.log("\n=== Full JSON Response ===\n");
    console.log(JSON.stringify(order, null, 2));
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

// Get order number from command line
const orderNumber = process.argv[2];

if (!orderNumber) {
  console.error("Usage: npx tsx scripts/debug-order-variants.ts <order-number>");
  process.exit(1);
}

debugOrderVariants(orderNumber).catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
