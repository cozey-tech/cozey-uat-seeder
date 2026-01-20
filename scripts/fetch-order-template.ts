#!/usr/bin/env tsx

/**
 * Fetch order template from Shopify order
 *
 * This script fetches an existing Shopify order by order number and converts it
 * to an order template that can be used with the seeder.
 *
 * Usage:
 *   npm run fetch-order-template -- <order-number>
 *   npm run fetch-order-template -- 4993
 *   npm run fetch-order-template -- 4993 --save
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createAdminApiClient } from "@shopify/admin-api-client";
import { initializeEnvConfig } from "../src/config/env";
import { Logger } from "../src/utils/logger";
import fs from "fs/promises";
import path from "path";

// Load .env files (same as main CLI)
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

interface OrderTemplate {
  id: string;
  name: string;
  description: string;
  lineItems: Array<{
    sku: string;
    quantity: number;
    pickType: "Regular" | "Pick and Pack";
    hasBarcode?: boolean;
  }>;
  customer?: {
    name: string;
    email: string;
    address?: string;
    city?: string;
    province?: string;
    postalCode?: string;
  };
  metadata?: {
    sourceOrderNumber: string;
    sourceOrderId: string;
    fetchedAt: string;
  };
}

interface ShopifyOrder {
  id: string;
  name: string;
  customer?: {
    firstName: string;
    lastName: string;
    email: string;
  };
  shippingAddress?: {
    address1: string;
    city: string;
    province: string;
    zip: string;
    country: string;
  };
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        sku: string;
        quantity: number;
        title: string;
      };
    }>;
  };
}

async function fetchOrderByNumber(orderNumber: string): Promise<ShopifyOrder | null> {
  const config = await initializeEnvConfig();

  const client = createAdminApiClient({
    storeDomain: config.SHOPIFY_STORE_DOMAIN,
    apiVersion: config.SHOPIFY_API_VERSION,
    accessToken: config.SHOPIFY_ACCESS_TOKEN,
  });

  // If it's already a GID, use the order query directly
  if (orderNumber.startsWith("gid://")) {
    const query = `
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          name
          customer {
            firstName
            lastName
            email
          }
          shippingAddress {
            address1
            city
            province
            zip
            country
          }
          lineItems(first: 250) {
            edges {
              node {
                id
                sku
                quantity
                title
              }
            }
          }
        }
      }
    `;

    const response = await client.request(query, { variables: { id: orderNumber } });
    return response.data?.order || null;
  }

  // Otherwise search by order name/number (e.g., "4993" or "#4993")
  const searchTerm = orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`;

  const query = `
    query getOrderByName($query: String!) {
      orders(first: 1, query: $query) {
        edges {
          node {
            id
            name
            customer {
              firstName
              lastName
              email
            }
            shippingAddress {
              address1
              city
              province
              zip
              country
            }
            lineItems(first: 250) {
              edges {
                node {
                  id
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
    const response = await client.request(query, { variables: { query: `name:${searchTerm}` } });

    if (!response.data?.orders?.edges || response.data.orders.edges.length === 0) {
      return null;
    }

    return response.data.orders.edges[0].node as ShopifyOrder;
  } catch (error) {
    throw new Error(`Failed to fetch order: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Detect pick type based on SKU pattern
 * Regular items typically start with numeric model codes (e.g., "42024-101-1")
 * Pick and Pack items often start with text codes (e.g., "LEG-2102-111-1")
 */
function detectPickType(sku: string): "Regular" | "Pick and Pack" {
  // Check if SKU starts with letters (likely PnP)
  if (/^[A-Z]/.test(sku)) {
    return "Pick and Pack";
  }
  // Default to Regular for numeric SKUs
  return "Regular";
}

function convertOrderToTemplate(order: ShopifyOrder): OrderTemplate {
  const orderNumber = order.name.replace("#", "");

  const lineItems = order.lineItems.edges
    .filter((edge) => edge.node.sku) // Filter out items without SKU
    .map((edge) => ({
      sku: edge.node.sku,
      quantity: edge.node.quantity,
      pickType: detectPickType(edge.node.sku),
    }));

  // Detect order type based on line items
  const hasRegular = lineItems.some((item) => item.pickType === "Regular");
  const hasPnP = lineItems.some((item) => item.pickType === "Pick and Pack");

  let orderType = "mixed";
  if (hasRegular && !hasPnP) {
    orderType = "regular-only";
  } else if (!hasRegular && hasPnP) {
    orderType = "pnp-only";
  }

  const template: OrderTemplate = {
    id: `order-${orderNumber}`,
    name: `Order ${orderNumber}`,
    description: `Template from Shopify order ${orderNumber} (${orderType})`,
    lineItems,
    metadata: {
      sourceOrderNumber: order.name,
      sourceOrderId: order.id,
      fetchedAt: new Date().toISOString(),
    },
  };

  // Include customer info if available
  if (order.customer) {
    template.customer = {
      name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
      email: order.customer.email,
    };

    if (order.shippingAddress) {
      template.customer.address = order.shippingAddress.address1;
      template.customer.city = order.shippingAddress.city;
      template.customer.province = order.shippingAddress.province;
      template.customer.postalCode = order.shippingAddress.zip;
    }
  }

  return template;
}

async function saveTemplate(template: OrderTemplate): Promise<void> {
  const configPath = path.join(process.cwd(), "config", "orderTemplates.json");

  try {
    const fileContent = await fs.readFile(configPath, "utf-8");
    const data = JSON.parse(fileContent);

    // Check if template with same ID already exists
    const existingIndex = data.templates.findIndex((t: OrderTemplate) => t.id === template.id);

    if (existingIndex >= 0) {
      Logger.warn(`Template with ID "${template.id}" already exists, replacing it`);
      data.templates[existingIndex] = template;
    } else {
      data.templates.push(template);
    }

    await fs.writeFile(configPath, JSON.stringify(data, null, 2) + "\n");
    Logger.info(`Template saved to ${configPath}`, { templateId: template.id });
  } catch (error) {
    throw new Error(`Failed to save template: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npm run fetch-order-template -- <order-number> [options]

Arguments:
  order-number    Shopify order number (e.g., 4993)

Options:
  --save         Save template to config/orderTemplates.json
  --help, -h     Show this help message

Examples:
  npm run fetch-order-template -- 4993
  npm run fetch-order-template -- 4993 --save
    `);
    process.exit(0);
  }

  const orderNumber = args[0];
  const shouldSave = args.includes("--save");

  Logger.info(`Fetching order ${orderNumber} from Shopify...`);

  try {
    const order = await fetchOrderByNumber(orderNumber);

    if (!order) {
      Logger.error(`Order ${orderNumber} not found`);
      process.exit(1);
    }

    Logger.info(`Found order ${order.name}`, {
      orderId: order.id,
      lineItems: order.lineItems.edges.length,
      hasCustomer: !!order.customer,
    });

    const template = convertOrderToTemplate(order);

    console.log("\n=== Order Template ===\n");
    console.log(JSON.stringify(template, null, 2));
    console.log();

    if (shouldSave) {
      await saveTemplate(template);
      Logger.info("✓ Template saved successfully");
    } else {
      Logger.info("Template not saved (use --save to save to config/orderTemplates.json)");
    }
  } catch (error) {
    Logger.error("Failed to fetch order template", error);
    process.exit(1);
  }
}

main();
