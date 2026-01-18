import { createAdminApiClient } from "@shopify/admin-api-client";
import { v4 as uuidv4 } from "uuid";
import { getEnvConfig } from "../config/env";
import { Logger } from "../utils/logger";
import type { GraphQLCostInfo } from "../shared/types/PerformanceMetrics";

export interface DraftOrderInput {
  customer: {
    name: string;
    email: string;
    address?: string;
    city?: string;
    province?: string;
    postalCode?: string;
  };
  lineItems: Array<{
    sku: string;
    quantity: number;
  }>;
}

export interface DraftOrderResult {
  draftOrderId: string;
  graphQLCost?: GraphQLCostInfo;
}

export interface OrderResult {
  orderId: string;
  orderNumber: string;
  graphQLCost?: GraphQLCostInfo;
  // Inspect if line items are available in the response
  lineItems?: Array<{
    lineItemId: string;
    sku: string;
    quantity: number;
  }>;
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
   * Extract GraphQL cost information from API response extensions
   * @param response - GraphQL API response
   * @returns Cost information if available, undefined otherwise
   */
  private extractGraphQLCost(response: unknown): GraphQLCostInfo | undefined {
    if (!response || typeof response !== "object") {
      return undefined;
    }

    const extensions = (response as { extensions?: unknown }).extensions;
    if (!extensions || typeof extensions !== "object") {
      return undefined;
    }

    const cost = (extensions as { cost?: unknown }).cost;
    if (!cost || typeof cost !== "object") {
      return undefined;
    }

    const costObj = cost as {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: {
        maximumAvailable?: number;
        currentlyAvailable?: number;
        restoreRate?: number;
      };
    };

    if (
      typeof costObj.requestedQueryCost === "number" &&
      typeof costObj.actualQueryCost === "number" &&
      costObj.throttleStatus &&
      typeof costObj.throttleStatus.maximumAvailable === "number" &&
      typeof costObj.throttleStatus.currentlyAvailable === "number" &&
      typeof costObj.throttleStatus.restoreRate === "number"
    ) {
      return {
        requestedQueryCost: costObj.requestedQueryCost,
        actualQueryCost: costObj.actualQueryCost,
        throttleStatus: {
          maximumAvailable: costObj.throttleStatus.maximumAvailable,
          currentlyAvailable: costObj.throttleStatus.currentlyAvailable,
          restoreRate: costObj.throttleStatus.restoreRate,
        },
      };
    }

    return undefined;
  }

  /**
   * Formats a batch tag for Shopify (ensures it doesn't exceed 40 character limit)
   * @param batchId - Unique batch ID
   * @returns Tag string truncated to 40 characters
   */
  formatBatchTag(batchId: string): string {
    const prefix = "seed_batch_id:";
    const maxTagLength = 40;
    const maxBatchIdLength = maxTagLength - prefix.length;
    
    // Truncate batchId if needed to fit within 40 character limit
    const truncatedBatchId = batchId.length > maxBatchIdLength 
      ? batchId.substring(0, maxBatchIdLength)
      : batchId;
    
    return `${prefix}${truncatedBatchId}`;
  }

  /**
   * Creates a draft order in Shopify
   *
   * @param input - Customer and line items for the draft order
   * @param batchId - Unique batch ID for tagging (format: wms_seed_<batchId>)
   * @param region - Optional region code (CA or US) for determining country code in shipping address
   * @param collectionPrepName - Optional collection prep name to include in order notes
   * @param variantMap - Optional pre-fetched variant map (SKU -> variant ID). If not provided, will lookup variants.
   * @returns Draft order ID
   * @throws ShopifyServiceError if variant lookup fails or API returns errors
   */
  async createDraftOrder(
    input: DraftOrderInput,
    batchId: string,
    region?: string,
    collectionPrepName?: string,
    variantMap?: Map<string, string>,
  ): Promise<DraftOrderResult> {
    if (this.dryRun) {
      const draftOrderId = `gid://shopify/DraftOrder/${uuidv4()}`;
      Logger.info("DRY RUN: Would create draft order", {
        customerEmail: input.customer.email,
        customerName: input.customer.name,
        shippingAddress: input.customer.address
          ? {
              address: input.customer.address,
              city: input.customer.city,
              province: input.customer.province,
              postalCode: input.customer.postalCode,
            }
          : undefined,
        batchId,
        collectionPrepName,
        draftOrderId,
        lineItemCount: input.lineItems.length,
        lineItems: input.lineItems.map((item) => ({ sku: item.sku, quantity: item.quantity })),
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
      // Get variant IDs for the SKUs (use provided map or lookup)
      let resolvedVariantMap = variantMap;
      if (!resolvedVariantMap) {
        // Fallback: lookup variants if not provided (backward compatibility)
        resolvedVariantMap = await this.findVariantIdsBySkus(input.lineItems.map((item) => item.sku));
      }

      // Build line items with variant IDs
      const lineItems = input.lineItems
        .map((item) => {
          const variantId = resolvedVariantMap.get(item.sku);
          if (!variantId) {
            throw new ShopifyServiceError(`Variant not found for SKU: ${item.sku}`);
          }
          return {
            variantId: variantId,
            quantity: item.quantity,
          };
        })
        .filter((item) => item !== null && item !== undefined);

      // Build shipping address if provided
      // Determine country code from region (CA -> "CA", US -> "US", default to "CA")
      const countryCode = region === "US" ? "US" : "CA";
      
      const shippingAddress = input.customer.address &&
        input.customer.city &&
        input.customer.province &&
        input.customer.postalCode
        ? {
            address1: input.customer.address,
            city: input.customer.city,
            province: input.customer.province,
            zip: input.customer.postalCode,
            country: countryCode,
          }
        : undefined;

      // Build note with collection prep name if provided
      let note = `WMS Seed Order - Batch: ${batchId}`;
      if (collectionPrepName) {
        note = `WMS Seed Order - Batch: ${batchId}\nCollection Prep: ${collectionPrepName}`;
      }

      const variables = {
        input: {
          email: input.customer.email,
          note,
          tags: [`wms_seed`, this.formatBatchTag(batchId)],
          customAttributes: [
            {
              key: "seed_batch_id",
              value: batchId,
            },
          ],
          lineItems: lineItems,
          ...(shippingAddress && { shippingAddress }),
        },
      };

      // Log shipping address inclusion for debugging
      if (shippingAddress) {
        Logger.info("Including shipping address in draft order", {
          customerEmail: input.customer.email,
          customerName: input.customer.name,
          shippingAddress: {
            address: shippingAddress.address1,
            city: shippingAddress.city,
            province: shippingAddress.province,
            postalCode: shippingAddress.zip,
            country: shippingAddress.country,
          },
        });
      } else {
        Logger.warn("Shipping address not included in draft order - missing address fields", {
          customerEmail: input.customer.email,
          customerName: input.customer.name,
          hasAddress: !!input.customer.address,
          hasCity: !!input.customer.city,
          hasProvince: !!input.customer.province,
          hasPostalCode: !!input.customer.postalCode,
        });
      }

      const response = await this.client.request(mutation, { variables });
      const graphQLCost = this.extractGraphQLCost(response);

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
        graphQLCost,
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

    // Inspect if line items are available in the response - query them to see
    const mutation = `
      mutation draftOrderComplete($id: ID!, $paymentPending: Boolean) {
        draftOrderComplete(id: $id, paymentPending: $paymentPending) {
          draftOrder {
            id
            order {
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
          userErrors {
            message
            field
          }
        }
      }
    `;

    const variables = {
      id: draftOrderId,
      paymentPending: false, // Mark as paid immediately so fulfillment can proceed
    };

    try {
      const response = await this.client.request(mutation, { variables });
      const graphQLCost = this.extractGraphQLCost(response);

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

      // Extract line items if available in the response
      const lineItems = order.lineItems?.edges?.map((edge: { node: { id: string; sku: string; quantity: number } }) => ({
        lineItemId: edge.node.id,
        sku: edge.node.sku || "",
        quantity: edge.node.quantity,
      }));

      return {
        orderId: order.id,
        orderNumber: order.name || "",
        graphQLCost,
        lineItems,
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
        status: "SUCCESS",
      });
      return { fulfillmentId, status: "SUCCESS" };
    }

    // First, get the order's line items and check for existing fulfillments
    const queryOrder = `
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          fulfillments {
            id
            status
          }
          lineItems(first: 250) {
            edges {
              node {
                id
                quantity
                fulfillableQuantity
              }
            }
          }
        }
      }
    `;

    try {
      // Get order line items and fulfillments
      const orderResponse = await this.client.request(queryOrder, { variables: { id: orderId } });
      
      // Check for GraphQL errors (errors can be an object with graphQLErrors array or a direct array)
      const graphQLErrors = orderResponse.errors?.graphQLErrors || 
                            (Array.isArray(orderResponse.errors) ? orderResponse.errors : []);
      
      if (graphQLErrors.length > 0) {
        Logger.error("GraphQL errors when querying order", undefined, {
          orderId,
          errors: graphQLErrors,
        });
        throw new ShopifyServiceError(
          `Failed to query order: ${graphQLErrors.map((e: { message: string }) => e.message).join(", ")}`,
        );
      }
      
      if (!orderResponse.data?.order) {
        throw new ShopifyServiceError(`Order ${orderId} not found`);
      }
      
      const order = orderResponse.data.order;

      // Check if order already has fulfillments (fulfillments is a plain list, not a connection)
      const existingFulfillments = order.fulfillments || [];
      if (existingFulfillments.length > 0) {
        const firstFulfillment = existingFulfillments[0];
        Logger.info("Order already has fulfillments, returning existing fulfillment", {
          orderId,
          fulfillmentId: firstFulfillment.id,
          status: firstFulfillment.status,
        });
        return {
          fulfillmentId: firstFulfillment.id,
          status: firstFulfillment.status || "SUCCESS",
        };
      }

      // Filter line items to only include fulfillable items
      const fulfillableLineItems = order.lineItems.edges
        .filter((edge: { node: { id: string; quantity: number; fulfillableQuantity: number } }) => {
          const fulfillableQty = edge.node.fulfillableQuantity ?? edge.node.quantity;
          return fulfillableQty > 0;
        })
        .map((edge: { node: { id: string; quantity: number; fulfillableQuantity: number } }) => ({
          id: edge.node.id,
          quantity: edge.node.fulfillableQuantity ?? edge.node.quantity,
        }));

      if (fulfillableLineItems.length === 0) {
        throw new ShopifyServiceError("No fulfillable line items found in order");
      }

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
          lineItems: fulfillableLineItems,
          notifyCustomer: false,
        },
      };

      const response = await this.client.request(mutation, { variables });

      // Check for GraphQL errors (errors can be an object with graphQLErrors array or a direct array)
      const fulfillmentGraphQLErrors = response.errors?.graphQLErrors || 
                                       (Array.isArray(response.errors) ? response.errors : []);
      
      if (fulfillmentGraphQLErrors.length > 0) {
        Logger.error("GraphQL errors when creating fulfillment", undefined, {
          orderId,
          errors: fulfillmentGraphQLErrors,
        });
        throw new ShopifyServiceError(
          `Failed to create fulfillment: ${fulfillmentGraphQLErrors.map((e: { message: string }) => e.message).join(", ")}`,
        );
      }

      if (response.data?.fulfillmentCreate?.userErrors?.length > 0) {
        const errors = response.data.fulfillmentCreate.userErrors;
        Logger.error("User errors when creating fulfillment", undefined, {
          orderId,
          userErrors: errors,
        });
        throw new ShopifyServiceError(
          `Failed to fulfill order: ${errors.map((e: { message: string }) => e.message).join(", ")}`,
          errors,
        );
      }

      const fulfillment = response.data?.fulfillmentCreate?.fulfillment;
      if (!fulfillment) {
        // Log the full response for debugging
        Logger.error("Fulfillment creation returned no data", undefined, {
          orderId,
          responseData: response.data,
          responseErrors: response.errors,
        });
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
      // Note: Cost tracking for query operations - can be logged but not returned in this method
      // since it returns OrderQueryResult[] which doesn't include cost info
      const graphQLCost = this.extractGraphQLCost(response);
      if (graphQLCost) {
        Logger.debug("GraphQL cost for queryOrdersByTag", {
          tag,
          cost: graphQLCost,
        });
      }

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
      Logger.info("DRY RUN: Would find variant IDs by SKUs", {
        skuCount: skus.length,
        skus: skus,
      });
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
      // Note: Cost tracking for variant lookup - can be logged but not returned
      // since it returns Map<string, string> which doesn't include cost info
      const graphQLCost = this.extractGraphQLCost(response);
      if (graphQLCost) {
        Logger.debug("GraphQL cost for findVariantIdsBySkus", {
          skuCount: skus.length,
          cost: graphQLCost,
        });
      }

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

  /**
   * Get GraphQL cost from a response (helper for performance tracking)
   * This is a public method to allow use cases to track costs
   */
  extractGraphQLCostFromResponse(response: unknown): GraphQLCostInfo | undefined {
    return this.extractGraphQLCost(response);
  }
}
