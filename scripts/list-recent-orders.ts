#!/usr/bin/env tsx

/**
 * List recent orders from Shopify
 * Helps verify order numbers exist before fetching templates
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { initializeEnvConfig } from "../src/config/env";
import { Logger } from "../src/utils/logger";

// Load .env files (same as main CLI)
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

async function listRecentOrders(limit: number = 20): Promise<void> {
  const config = await initializeEnvConfig();

  const client = createAdminApiClient({
    storeDomain: config.SHOPIFY_STORE_DOMAIN,
    apiVersion: config.SHOPIFY_API_VERSION,
    accessToken: config.SHOPIFY_ACCESS_TOKEN,
  });

  const query = `
    query getRecentOrders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            lineItems(first: 5) {
              edges {
                node {
                  sku
                  quantity
                  title
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

    if (!response.data?.orders?.edges) {
      console.log("No orders found");
      return;
    }

    console.log(`\n=== Recent ${limit} Orders ===\n`);

    for (const edge of response.data.orders.edges) {
      const order = edge.node;
      const skus = order.lineItems.edges
        .map((li: { node: { sku?: string } }) => li.node.sku)
        .filter(Boolean)
        .join(", ");

      console.log(`${order.name} (${order.displayFulfillmentStatus})`);
      console.log(`  Created: ${new Date(order.createdAt).toISOString()}`);
      console.log(`  SKUs: ${skus || "No SKUs"}`);
      console.log();
    }
  } catch (error) {
    Logger.error("Failed to list orders", error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const limit = process.argv[2] ? parseInt(process.argv[2]) : 20;
  await listRecentOrders(limit);
}

main();
