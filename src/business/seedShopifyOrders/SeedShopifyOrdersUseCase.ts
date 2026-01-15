import type { SeedShopifyOrdersRequest } from "../../shared/requests/SeedShopifyOrdersRequest";
import type { SeedShopifyOrdersResponse } from "../../shared/responses/SeedShopifyOrdersResponse";
import { ShopifyService } from "../../services/ShopifyService";

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

        if (!createdOrder) {
          throw new Error(`Failed to query created order: ${orderResult.orderId}`);
        }

        shopifyOrders.push({
          shopifyOrderId: orderResult.orderId,
          shopifyOrderNumber: orderResult.orderNumber,
          lineItems: createdOrder.lineItems.map((item) => ({
            lineItemId: item.lineItemId,
            sku: item.sku,
          })),
          fulfillmentStatus: fulfillmentResult.status,
        });
      } catch (error) {
        // Log error but continue with other orders
        console.error(`Failed to create order for customer ${orderInput.customer.email}:`, error);
        throw error; // Re-throw to fail fast - can be changed to continue on error if needed
      }
    }

    return {
      shopifyOrders,
    };
  }
}
