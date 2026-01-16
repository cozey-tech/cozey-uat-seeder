import { createAdminApiClient } from "@shopify/admin-api-client";
import { v4 as uuidv4 } from "uuid";
import { getEnvConfig } from "../config/env";
import { Logger } from "../utils/logger";

export interface DraftOrderInput {
  customer: {
    name: string;
    email: string;
  };
  lineItems: Array<{
    sku: string;
    quantity: number;
  }>;
}

export interface DraftOrderResult {
  draftOrderId: string;
}

export interface OrderResult {
  orderId: string;
  orderNumber: string;
}

export interface FulfillmentResult {
  fulfillmentId: string;
  status: string;
}

export interface OrderLineItem {
  lineItemId: string;
  sku: string;
  quantity: number;
}

export interface OrderQueryResult {
  orderId: string;
  orderNumber: string;
  lineItems: OrderLineItem[];
}

export class ShopifyServiceError extends Error {
  constructor(message: string, public readonly userErrors?: Array<{ message: string; field?: string[] }>) {
    super(message);
    this.name = "ShopifyServiceError";
    Object.setPrototypeOf(this, ShopifyServiceError.prototype);
  }
}

/**
 * Service for interacting with Shopify Admin GraphQL API
 *
 * Handles:
 * - Draft order creation and completion
 * - Order fulfillment
 * - Order querying by tags
 * - Variant lookup by SKU
 */
export class ShopifyService {
  private readonly client: ReturnType<typeof createAdminApiClient>;
  private readonly dryRun: boolean;
  private orderNumberCounter: number;

  /**
   * Initializes Shopify Admin API client with credentials from environment variables
   * @param dryRun - If true, skip actual API calls and return mock data
   */
  constructor(dryRun: boolean = false) {
    this.dryRun = dryRun;
    this.orderNumberCounter = 1000; // Start from #1000 for deterministic order numbers
    const config = getEnvConfig();
    this.client = createAdminApiClient({
      storeDomain: config.SHOPIFY_STORE_DOMAIN,
      apiVersion: config.SHOPIFY_API_VERSION,
      accessToken: config.SHOPIFY_ACCESS_TOKEN,
    });
  }

  /**
   * Creates a draft order in Shopify
   *
   * @param input - Customer and line items for the draft order
   * @param batchId - Unique batch ID for tagging (format: wms_seed_<batchId>)
   * @returns Draft order ID
   * @throws ShopifyServiceError if variant lookup fails or API returns errors
   */
  async createDraftOrder(input: DraftOrderInput, batchId: string): Promise<DraftOrderResult> {
    if (this.dryRun) {
      const draftOrderId = `gid://shopify/DraftOrder/${uuidv4()}`;
      Logger.info("DRY RUN: Would create draft order", {
        customerEmail: input.customer.email,
        batchId,
        draftOrderId,
      });
      return { draftOrderId };
    }

    // First, we need to find variant IDs by SKU
    // For now, we'll use a simplified approach - in production, you'd query products by SKU
    const mutation = `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            name
          }
          userErrors {
            message
            field
          }
        }
      }
    `;

    try {
      // First, get variant IDs for the SKUs
      const variantMap = await this.findVariantIdsBySkus(input.lineItems.map((item) => item.sku));

      // Build line items with variant IDs
      const lineItems = input.lineItems
        .map((item) => {
          const variantId = variantMap.get(item.sku);
          if (!variantId) {
            throw new ShopifyServiceError(`Variant not found for SKU: ${item.sku}`);
          }
          return {
            variantId: variantId,
            quantity: item.quantity,
          };
        })
        .filter((item) => item !== null && item !== undefined);

      const variables = {
        input: {
          email: input.customer.email,
          note: `WMS Seed Order - Batch: ${batchId}`,
          tags: [`wms_seed`, `seed_batch_id:${batchId}`],
          customAttributes: [
            {
              key: "seed_batch_id",
              value: batchId,
            },
          ],
          lineItems: lineItems,
        },
      };

      const response = await this.client.request(mutation, { variables });

      if (response.data?.draftOrderCreate?.userErrors?.length > 0) {
        const errors = response.data.draftOrderCreate.userErrors;
        throw new ShopifyServiceError(
          `Failed to create draft order: ${errors.map((e: { message: string }) => e.message).join(", ")}`,
          errors,
        );
      }

      const draftOrder = response.data?.draftOrderCreate?.draftOrder;
      if (!draftOrder) {
        throw new ShopifyServiceError("Draft order creation returned no data");
      }

      return {
        draftOrderId: draftOrder.id,
      };
    } catch (error) {
      if (error instanceof ShopifyServiceError) {
        throw error;
      }
      throw new ShopifyServiceError(`Failed to create draft order: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async completeDraftOrder(draftOrderId: string): Promise<OrderResult> {
    if (this.dryRun) {
      // Generate a deterministic order number (e.g., #1000, #1001, #1002, etc.)
      const orderNumber = `#${this.orderNumberCounter++}`;
      const orderId = `gid://shopify/Order/${uuidv4()}`;
      Logger.info("DRY RUN: Would complete draft order", {
        draftOrderId,
        orderId,
        orderNumber,
      });
      return { orderId, orderNumber };
    }

    const mutation = `
      mutation draftOrderComplete($id: ID!) {
        draftOrderComplete(id: $id) {
          draftOrder {
            id
            order {
              id
              name
            }
          }
          userErrors {
            message
            field
          }
        }
      }
    `;

    const variables = {
      id: draftOrderId,
    };

    try {
      const response = await this.client.request(mutation, { variables });

      if (response.data?.draftOrderComplete?.userErrors?.length > 0) {
        const errors = response.data.draftOrderComplete.userErrors;
        throw new ShopifyServiceError(
          `Failed to complete draft order: ${errors.map((e: { message: string }) => e.message).join(", ")}`,
          errors,
        );
      }

      const order = response.data?.draftOrderComplete?.draftOrder?.order;
      if (!order) {
        throw new ShopifyServiceError("Draft order completion returned no order data");
      }

      return {
        orderId: order.id,
        orderNumber: order.name || "",
      };
    } catch (error) {
      if (error instanceof ShopifyServiceError) {
        throw error;
      }
      throw new ShopifyServiceError(`Failed to complete draft order: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fulfillOrder(orderId: string): Promise<FulfillmentResult> {
    if (this.dryRun) {
      const fulfillmentId = `gid://shopify/Fulfillment/${uuidv4()}`;
      Logger.info("DRY RUN: Would fulfill order", {
        orderId,
        fulfillmentId,
      });
      return { fulfillmentId, status: "SUCCESS" };
    }

    // First, get the order's line items
    const queryOrder = `
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          lineItems(first: 250) {
            edges {
              node {
                id
                quantity
              }
            }
          }
        }
      }
    `;

    try {
      // Get order line items
      const orderResponse = await this.client.request(queryOrder, { variables: { id: orderId } });
      if (orderResponse.errors || !orderResponse.data?.order) {
        throw new ShopifyServiceError(`Order ${orderId} not found`);
      }
      const order = orderResponse.data.order;

      const lineItems = order.lineItems.edges.map((edge: { node: { id: string; quantity: number } }) => ({
        id: edge.node.id,
        quantity: edge.node.quantity,
      }));

      // Create fulfillment
      const mutation = `
        mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment {
              id
              status
            }
            userErrors {
              message
              field
            }
          }
        }
      `;

      const variables = {
        fulfillment: {
          orderId: orderId,
          lineItems: lineItems,
          notifyCustomer: false,
          trackingInfo: {
            number: "",
            company: "",
          },
        },
      };

      const response = await this.client.request(mutation, { variables });

      if (response.data?.fulfillmentCreate?.userErrors?.length > 0) {
        const errors = response.data.fulfillmentCreate.userErrors;
        throw new ShopifyServiceError(
          `Failed to fulfill order: ${errors.map((e: { message: string }) => e.message).join(", ")}`,
          errors,
        );
      }

      const fulfillment = response.data?.fulfillmentCreate?.fulfillment;
      if (!fulfillment) {
        throw new ShopifyServiceError("Fulfillment creation returned no data");
      }

      return {
        fulfillmentId: fulfillment.id,
        status: fulfillment.status || "SUCCESS",
      };
    } catch (error) {
      if (error instanceof ShopifyServiceError) {
        throw error;
      }
      throw new ShopifyServiceError(`Failed to fulfill order: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async queryOrdersByTag(tag: string): Promise<OrderQueryResult[]> {
    if (this.dryRun) {
      // In dry-run, return empty array - the use case will construct mock data
      // This is called after order creation, so we return empty and let the use case
      // construct the response from the input data
      Logger.info("DRY RUN: Would query orders by tag", { tag });
      return [];
    }

    const query = `
      query getOrdersByTag($query: String!) {
        orders(first: 250, query: $query) {
          edges {
            node {
              id
              name
              lineItems(first: 250) {
                edges {
                  node {
                    id
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

    const variables = {
      query: `tag:${tag}`,
    };

    try {
      const response = await this.client.request(query, { variables });

      const orders = response.data?.orders?.edges || [];
      return orders.map((edge: { node: { id: string; name: string; lineItems: { edges: Array<{ node: { id: string; sku: string; quantity: number } }> } } }) => ({
        orderId: edge.node.id,
        orderNumber: edge.node.name || "",
        lineItems: edge.node.lineItems.edges.map((itemEdge) => ({
          lineItemId: itemEdge.node.id,
          sku: itemEdge.node.sku || "",
          quantity: itemEdge.node.quantity,
        })),
      }));
    } catch (error) {
      throw new ShopifyServiceError(`Failed to query orders by tag: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Helper method to find variant IDs by SKU
  async findVariantIdsBySkus(skus: string[]): Promise<Map<string, string>> {
    if (this.dryRun) {
      // Return mock variant IDs for each SKU
      const variantMap = new Map<string, string>();
      for (const sku of skus) {
        variantMap.set(sku, `gid://shopify/ProductVariant/${uuidv4()}`);
      }
      Logger.info("DRY RUN: Would find variant IDs by SKUs", { skus: skus.length });
      return variantMap;
    }

    const query = `
      query getProductsBySkus($query: String!) {
        products(first: 250, query: $query) {
          edges {
            node {
              variants(first: 250) {
                edges {
                  node {
                    id
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;

    const skuQuery = skus.map((sku) => `sku:${sku}`).join(" OR ");
    const variables = {
      query: skuQuery,
    };

    try {
      const response = await this.client.request(query, { variables });

      const variantMap = new Map<string, string>();
      const products = response.data?.products?.edges || [];

      for (const productEdge of products) {
        const variants = productEdge.node.variants.edges || [];
        for (const variantEdge of variants) {
          const variant = variantEdge.node;
          if (variant.sku && skus.includes(variant.sku)) {
            variantMap.set(variant.sku, variant.id);
          }
        }
      }

      return variantMap;
    } catch (error) {
      throw new ShopifyServiceError(`Failed to find variants by SKUs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
