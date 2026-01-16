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
        );

        // Complete draft order
        const orderResult = await this.shopifyService.completeDraftOrder(draftOrderResult.draftOrderId);

        // Fulfill order
        const fulfillmentResult = await this.shopifyService.fulfillOrder(orderResult.orderId);

        // Query order to get line item IDs
        const orderQueryResults = await this.shopifyService.queryOrdersByTag(`seed_batch_id:${request.batchId}`);
        const createdOrder = orderQueryResults.find((o) => o.orderId === orderResult.orderId);

        // In dry-run mode, queryOrdersByTag returns empty array, so construct from input
        let lineItems: Array<{ lineItemId: string; sku: string }>;
        if (!createdOrder) {
          // This happens in dry-run mode - construct line items from input
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
          fulfillmentStatus: fulfillmentResult.status,
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
