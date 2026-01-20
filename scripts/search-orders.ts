#!/usr/bin/env tsx

/**
 * Search for specific orders by number including archived ones
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { initializeEnvConfig } from "../src/config/env";

// Load .env files (same as main CLI)
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

async function searchOrders(orderNumbers: string[]): Promise<void> {
  const config = await initializeEnvConfig();

  const client = createAdminApiClient({
    storeDomain: config.SHOPIFY_STORE_DOMAIN,
    apiVersion: config.SHOPIFY_API_VERSION,
    accessToken: config.SHOPIFY_ACCESS_TOKEN,
  });

  console.log(`\n=== Searching for ${orderNumbers.length} orders in ${config.SHOPIFY_STORE_DOMAIN} ===\n`);

  for (const orderNumber of orderNumbers) {
    // Try different query formats
    const queries = [`name:#${orderNumber}`, `name:${orderNumber}`, `#${orderNumber}`, orderNumber];

    let found = false;

    for (const queryStr of queries) {
      try {
        const query = `
          query searchOrders($query: String!) {
            orders(first: 5, query: $query) {
              edges {
                node {
                  id
                  name
                  createdAt
                  displayFinancialStatus
                  displayFulfillmentStatus
                  archived
                  lineItems(first: 5) {
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

        const response = await client.request(query, { variables: { query: queryStr } });

        if (response.data?.orders?.edges && response.data.orders.edges.length > 0) {
          const order = response.data.orders.edges[0].node;
          const skus = order.lineItems.edges.map((li: { node: { sku?: string } }) => li.node.sku).filter(Boolean);

          console.log(`✓ Found order ${order.name} (query: "${queryStr}")`);
          console.log(`  Created: ${new Date(order.createdAt).toISOString()}`);
          console.log(`  Status: ${order.displayFulfillmentStatus} / ${order.displayFinancialStatus}`);
          console.log(`  Archived: ${order.archived}`);
          console.log(`  SKUs: ${skus.join(", ") || "No SKUs"}`);
          console.log();

          found = true;
          break;
        }
      } catch {
        // Continue to next query format
      }
    }

    if (!found) {
      console.log(`✗ Order ${orderNumber} not found (tried: ${queries.join(", ")})`);
    }
  }
}

async function main(): Promise<void> {
  const orderNumbers = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

  if (orderNumbers.length === 0) {
    console.log(`
Usage: npm run search-orders -- <order-numbers...>

Examples:
  npm run search-orders -- 4993
  npm run search-orders -- 4993 4994 4995
    `);
    process.exit(0);
  }

  await searchOrders(orderNumbers);
}

main();
