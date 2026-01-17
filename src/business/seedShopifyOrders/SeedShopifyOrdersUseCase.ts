import type { SeedShopifyOrdersRequest } from "../../shared/requests/SeedShopifyOrdersRequest";
import type { SeedShopifyOrdersResponse } from "../../shared/responses/SeedShopifyOrdersResponse";
import { ShopifyService } from "../../services/ShopifyService";
import { Logger } from "../../utils/logger";
import { v4 as uuidv4 } from "uuid";

export class SeedShopifyOrdersUseCase {
  constructor(private readonly shopifyService: ShopifyService) {}

  async execute(request: SeedShopifyOrdersRequest): Promise<SeedShopifyOrdersResponse> {
    const shopifyOrders: SeedShopifyOrdersResponse["shopifyOrders"] = [];

    // Process orders sequentially to avoid rate limits
    for (const orderInput of request.orders) {
      try {
        // Create draft order
        const draftOrderResult = await this.shopifyService.createDraftOrder(
          {
            customer: orderInput.customer,
            lineItems: orderInput.lineItems,
          },
          request.batchId,
          request.region,
        );

        // Complete draft order
        const orderResult = await this.shopifyService.completeDraftOrder(draftOrderResult.draftOrderId);

        // Note: Orders are created and marked as paid, but NOT fulfilled
        // Fulfillment is not part of the seeding process

        // Query order to get line item IDs
        // Use the same tag format as when creating the order (truncated to 40 chars)
        const batchTag = this.shopifyService.formatBatchTag(request.batchId);
        const orderQueryResults = await this.shopifyService.queryOrdersByTag(batchTag);
        const createdOrder = orderQueryResults.find((o) => o.orderId === orderResult.orderId);

        // In dry-run mode, queryOrdersByTag returns empty array, so construct from input
        let lineItems: Array<{ lineItemId: string; sku: string }>;
        if (!createdOrder) {
          // This happens in dry-run mode - construct line items from input
          // In normal mode, this would indicate a problem (order not found after creation)
          Logger.warn("Order not found in query results, constructing line items from input", {
            orderId: orderResult.orderId,
            batchId: request.batchId,
          });
          lineItems = orderInput.lineItems.map((item) => ({
            lineItemId: `gid://shopify/LineItem/${uuidv4()}`,
            sku: item.sku,
          }));
        } else {
          lineItems = createdOrder.lineItems.map((item) => ({
            lineItemId: item.lineItemId,
            sku: item.sku,
          }));
        }

        shopifyOrders.push({
          shopifyOrderId: orderResult.orderId,
          shopifyOrderNumber: orderResult.orderNumber,
          lineItems,
          fulfillmentStatus: "UNFULFILLED", // Orders are not fulfilled during seeding
        });
      } catch (error) {
        // Log error with structured logging
        Logger.error("Failed to create Shopify order", error, {
          batchId: request.batchId,
          customerEmail: orderInput.customer.email,
        });
        throw error; // Re-throw to fail fast - can be changed to continue on error if needed
      }
    }

    return {
      shopifyOrders,
    };
  }
}
