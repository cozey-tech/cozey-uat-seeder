#!/usr/bin/env tsx

/**
 * Batch fetch order templates from multiple Shopify orders
 *
 * This script fetches multiple existing Shopify orders by order number and converts
 * them to order templates that can be used with the seeder.
 *
 * Usage:
 *   npm run fetch-order-templates-batch -- <order-numbers...>
 *   npm run fetch-order-templates-batch -- 4993 4994 4995 --save
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
    notes?: string;
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

async function fetchOrderByNumber(
  client: ReturnType<typeof createAdminApiClient>,
  orderNumber: string,
): Promise<ShopifyOrder | null> {
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
                variant {
                  id
                  sku
                  title
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
                  variant {
                    id
                    sku
                    title
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
      return null;
    }

    return response.data.orders.edges[0].node as ShopifyOrder;
  } catch (error) {
    throw new Error(`Failed to fetch order ${orderNumber}: ${error instanceof Error ? error.message : String(error)}`);
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

function convertOrderToTemplate(order: ShopifyOrder, notes?: string): OrderTemplate {
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
    description: `Template from Shopify order ${orderNumber} (${orderType})${notes ? ` - ${notes}` : ""}`,
    lineItems,
    metadata: {
      sourceOrderNumber: order.name,
      sourceOrderId: order.id,
      fetchedAt: new Date().toISOString(),
      ...(notes && { notes }),
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

async function saveTemplates(templates: OrderTemplate[]): Promise<void> {
  const configPath = path.join(process.cwd(), "config", "orderTemplates.json");

  try {
    const fileContent = await fs.readFile(configPath, "utf-8");
    const data = JSON.parse(fileContent);

    for (const template of templates) {
      const existingIndex = data.templates.findIndex((t: OrderTemplate) => t.id === template.id);

      if (existingIndex >= 0) {
        Logger.warn(`Template "${template.id}" already exists, replacing it`);
        data.templates[existingIndex] = template;
      } else {
        data.templates.push(template);
      }
    }

    await fs.writeFile(configPath, JSON.stringify(data, null, 2) + "\n");
    Logger.info(`${templates.length} template(s) saved to ${configPath}`);
  } catch (error) {
    throw new Error(`Failed to save templates: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface OrderConfig {
  orderNumber: string;
  notes?: string;
}

function parseOrderConfigs(args: string[]): OrderConfig[] {
  const configs: OrderConfig[] = [];
  let currentOrder: string | null = null;
  let currentNotes: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--")) {
      // Skip option flags
      continue;
    }

    // Check if this looks like an order number (numeric)
    if (/^\d+$/.test(arg)) {
      // Save previous order if exists
      if (currentOrder) {
        configs.push({
          orderNumber: currentOrder,
          notes: currentNotes.length > 0 ? currentNotes.join(" ") : undefined,
        });
      }
      // Start new order
      currentOrder = arg;
      currentNotes = [];
    } else {
      // This is a note for the current order
      if (currentOrder) {
        currentNotes.push(arg);
      }
    }
  }

  // Save last order
  if (currentOrder) {
    configs.push({
      orderNumber: currentOrder,
      notes: currentNotes.length > 0 ? currentNotes.join(" ") : undefined,
    });
  }

  return configs;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npm run fetch-order-templates-batch -- <order-numbers...> [options]

Arguments:
  order-numbers   Space-separated Shopify order numbers (e.g., 4993 4994 4995)

Options:
  --save         Save templates to config/orderTemplates.json
  --help, -h     Show this help message

Examples:
  npm run fetch-order-templates-batch -- 4993 4994 4995
  npm run fetch-order-templates-batch -- 4993 4994 4995 --save
  npm run fetch-order-templates-batch -- 5008 5048 5049 --save
    `);
    process.exit(0);
  }

  const shouldSave = args.includes("--save");
  const orderConfigs = parseOrderConfigs(args.filter((arg) => arg !== "--save"));

  if (orderConfigs.length === 0) {
    Logger.error("No order numbers provided");
    process.exit(1);
  }

  Logger.info(`Fetching ${orderConfigs.length} order(s) from Shopify...`);

  try {
    const config = await initializeEnvConfig();

    const client = createAdminApiClient({
      storeDomain: config.SHOPIFY_STORE_DOMAIN,
      apiVersion: config.SHOPIFY_API_VERSION,
      accessToken: config.SHOPIFY_ACCESS_TOKEN,
    });

    const templates: OrderTemplate[] = [];
    const errors: Array<{ orderNumber: string; error: string }> = [];

    for (const orderConfig of orderConfigs) {
      try {
        Logger.info(`Fetching order ${orderConfig.orderNumber}...`);

        const order = await fetchOrderByNumber(client, orderConfig.orderNumber);

        if (!order) {
          errors.push({
            orderNumber: orderConfig.orderNumber,
            error: "Order not found",
          });
          continue;
        }

        Logger.info(`✓ Found order ${order.name}`, {
          orderId: order.id,
          lineItems: order.lineItems.edges.length,
        });

        const template = convertOrderToTemplate(order, orderConfig.notes);
        templates.push(template);

        // Add a small delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        errors.push({
          orderNumber: orderConfig.orderNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log("\n=== Fetched Templates ===\n");

    if (templates.length > 0) {
      console.log(JSON.stringify({ templates }, null, 2));
      console.log();
      Logger.info(`Successfully fetched ${templates.length} template(s)`);
    }

    if (errors.length > 0) {
      console.log("\n=== Errors ===\n");
      for (const error of errors) {
        Logger.error(`Order ${error.orderNumber}: ${error.error}`);
      }
    }

    if (shouldSave && templates.length > 0) {
      await saveTemplates(templates);
      Logger.info("✓ Templates saved successfully");
    } else if (!shouldSave && templates.length > 0) {
      console.log("\nTemplates not saved (use --save to save to config/orderTemplates.json)");
    }

    if (errors.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    Logger.error("Failed to fetch order templates", error);
    process.exit(1);
  }
}

main();
