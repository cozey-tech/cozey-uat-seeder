import type { SeedWmsEntitiesRequest } from "../../shared/requests/SeedWmsEntitiesRequest";
import type { SeedWmsEntitiesResponse } from "../../shared/responses/SeedWmsEntitiesResponse";
import { WmsService } from "../../services/WmsService";

export class SeedWmsEntitiesUseCase {
  constructor(private readonly wmsService: WmsService) {}

  async execute(request: SeedWmsEntitiesRequest): Promise<SeedWmsEntitiesResponse> {
    const orders: SeedWmsEntitiesResponse["orders"] = [];
    const shipments: SeedWmsEntitiesResponse["shipments"] = [];
    const prepPartItems: SeedWmsEntitiesResponse["prepPartItems"] = [];

    for (const shopifyOrder of request.shopifyOrders) {
      // Create order with customer
      const { orderId } = await this.wmsService.createOrderWithCustomer(
        shopifyOrder.shopifyOrderId,
        shopifyOrder.shopifyOrderNumber,
        "fulfilled", // Status from fulfilled Shopify order
        request.region,
        "Seed Customer", // Default customer name
        "seed@example.com", // Default customer email
      );

      orders.push({
        orderId: orderId,
        shopifyOrderId: shopifyOrder.shopifyOrderId,
      });

      // Create variantOrders
      const variantOrders = await this.wmsService.createVariantOrdersForOrder(
        shopifyOrder.shopifyOrderId, // Use shopifyOrderId as orderId reference
        shopifyOrder.lineItems.map((item) => ({
          lineItemId: item.lineItemId,
          sku: item.sku,
          quantity: 1, // Default quantity - could be enhanced to get from Shopify
        })),
        request.region,
      );

      // Create preps
      const preps = await this.wmsService.createPrepsForOrder(
        shopifyOrder.shopifyOrderId,
        variantOrders,
        request.collectionPrepId,
        request.region,
      );

      // Create prepParts and prepPartItems
      const prepPartsAndItems = await this.wmsService.createPrepPartsAndItems(
        preps,
        shopifyOrder.lineItems.map((item) => ({
          lineItemId: item.lineItemId,
          sku: item.sku,
          quantity: 1,
        })),
        request.region,
      );

      // Collect prepPartItem IDs
      for (const prepPartItem of prepPartsAndItems) {
        prepPartItems.push({
          prepPartItemId: prepPartItem.prepPartItemId,
          partId: prepPartItem.partId,
        });
      }

      // Create shipment if collectionPrepId is provided
      if (request.collectionPrepId) {
        const shipmentId = await this.wmsService.createShipmentForOrder(
          request.collectionPrepId,
          shopifyOrder.shopifyOrderId,
          request.region,
        );

        shipments.push({
          shipmentId: shipmentId,
          orderId: shopifyOrder.shopifyOrderId,
        });
      }
    }

    return {
      orders,
      shipments,
      prepPartItems,
    };
  }
}
