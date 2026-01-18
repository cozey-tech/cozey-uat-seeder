import type { SeedWmsEntitiesRequest } from "../../shared/requests/SeedWmsEntitiesRequest";
import type { SeedWmsEntitiesResponse } from "../../shared/responses/SeedWmsEntitiesResponse";
import { WmsService } from "../../services/WmsService";
import { Logger } from "../../utils/logger";

export class SeedWmsEntitiesUseCase {
  constructor(private readonly wmsService: WmsService) {}

  async execute(request: SeedWmsEntitiesRequest): Promise<SeedWmsEntitiesResponse> {
    const operationId = Logger.startOperation("seedWmsEntities", {
      shopifyOrderCount: request.shopifyOrders.length,
      region: request.region,
      collectionPrepId: request.collectionPrepId,
    });

    const startTime = Date.now();
    const orders: SeedWmsEntitiesResponse["orders"] = [];
    const shipments: SeedWmsEntitiesResponse["shipments"] = [];
    const prepPartItems: SeedWmsEntitiesResponse["prepPartItems"] = [];
    const failures: SeedWmsEntitiesResponse["failures"] = [];

    for (let orderIndex = 0; orderIndex < request.shopifyOrders.length; orderIndex++) {
      const shopifyOrder = request.shopifyOrders[orderIndex];
      const orderOperationId = Logger.startOperation("createWmsEntitiesForOrder", {
        orderIndex,
        shopifyOrderId: shopifyOrder.shopifyOrderId,
      });
      
      try {
      // Check if order already exists (idempotency)
      const existingOrder = await this.wmsService.repository.findOrderByShopifyId(shopifyOrder.shopifyOrderId);
      if (existingOrder) {
        // Order already exists, skip creation but include in response
        orders.push({
          orderId: existingOrder.id,
          shopifyOrderId: existingOrder.shopifyOrderId,
        });
        
        // Notify progress callback of success (idempotent order)
        if (request.onOrderProgress) {
          request.onOrderProgress(orderIndex + 1, request.shopifyOrders.length, shopifyOrder.shopifyOrderId, true);
        }
        
        // Close operation tracking before continuing
        Logger.endOperation(orderOperationId, true, {
          orderId: existingOrder.id,
          idempotent: true,
        });
        continue; // Skip to next order
      }

      // Use actual data from Shopify order, with sensible defaults
      // Orders are paid but not fulfilled during seeding
      const orderStatus = shopifyOrder.status || "paid";
      const customerName = shopifyOrder.customerName || "Seed Customer";
      const customerEmail = shopifyOrder.customerEmail || "seed@example.com";

      // Create order with customer
      const { orderDbId, shopifyOrderId: createdShopifyOrderId } =
        await this.wmsService.createOrderWithCustomer(
          shopifyOrder.shopifyOrderId,
          shopifyOrder.shopifyOrderNumber,
          orderStatus,
          request.region,
          customerName,
          customerEmail,
        );

      orders.push({
        orderId: orderDbId,
        shopifyOrderId: createdShopifyOrderId,
      });

      // Create variantOrders - use actual quantities from Shopify
      const variantOrders = await this.wmsService.createVariantOrdersForOrder(
        shopifyOrder.shopifyOrderId, // Use shopifyOrderId as orderId reference (per schema FK)
        shopifyOrder.lineItems.map((item) => ({
          lineItemId: item.lineItemId,
          sku: item.sku,
          quantity: item.quantity || 1, // Use actual quantity from Shopify, default to 1
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

      // Create prepParts and prepPartItems - use actual quantities
      const prepPartsAndItems = await this.wmsService.createPrepPartsAndItems(
        preps,
        shopifyOrder.lineItems.map((item) => ({
          lineItemId: item.lineItemId,
          sku: item.sku,
          quantity: item.quantity || 1, // Use actual quantity from Shopify
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
          orderId: orderDbId, // Use WMS database order ID, not Shopify order ID
        });
      }
      
      // Notify progress callback of success
      if (request.onOrderProgress) {
        request.onOrderProgress(orderIndex + 1, request.shopifyOrders.length, shopifyOrder.shopifyOrderId, true);
      }
      
      Logger.endOperation(orderOperationId, true, {
        orderId: orders[orders.length - 1]?.orderId,
        shipmentId: shipments[shipments.length - 1]?.shipmentId,
      });
      } catch (error) {
        // Continue-on-error strategy: collect errors, don't fail entire batch
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.error("Failed to create WMS entities for order", error, {
          shopifyOrderId: shopifyOrder.shopifyOrderId,
          orderIndex,
          customerEmail: shopifyOrder.customerEmail,
        });

        failures.push({
          orderIndex,
          shopifyOrderId: shopifyOrder.shopifyOrderId,
          customerEmail: shopifyOrder.customerEmail,
          error: errorMessage,
        });
        
        // Notify progress callback of failure
        if (request.onOrderProgress) {
          request.onOrderProgress(orderIndex + 1, request.shopifyOrders.length, shopifyOrder.shopifyOrderId, false);
        }
        
        Logger.endOperation(orderOperationId, false, {
          error: errorMessage,
        });
      }
    }

    // Log errors if any occurred
    if (failures.length > 0) {
      Logger.warn("Some WMS entity creations failed", {
        failedCount: failures.length,
        totalOrders: request.shopifyOrders.length,
        successfulCount: orders.length,
        errors: failures.map((f) => ({
          orderIndex: f.orderIndex,
          shopifyOrderId: f.shopifyOrderId,
          error: f.error,
        })),
      });

      // If all orders failed, throw an error
      if (failures.length === request.shopifyOrders.length) {
        throw new Error(
          `All ${request.shopifyOrders.length} WMS entity creations failed. First error: ${failures[0]?.error}`,
        );
      }
    }

    const totalDuration = Date.now() - startTime;
    const result = {
      orders,
      shipments,
      prepPartItems,
      failures: failures.length > 0 ? failures : undefined,
    };

    // Log performance metrics
    Logger.performance({
      operation: "seedWmsEntities",
      duration: totalDuration,
      itemCount: request.shopifyOrders.length,
      successfulCount: orders.length,
      failedCount: failures.length,
      ordersCreated: orders.length,
      shipmentsCreated: shipments.length,
      prepPartItemsCreated: prepPartItems.length,
    });

    Logger.endOperation(operationId, failures.length === 0, {
      successfulOrders: orders.length,
      failedOrders: failures.length,
      shipmentsCreated: shipments.length,
      duration: totalDuration,
    });

    return result;
  }
}
