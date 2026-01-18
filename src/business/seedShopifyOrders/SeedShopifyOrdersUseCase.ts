import type { SeedShopifyOrdersRequest } from "../../shared/requests/SeedShopifyOrdersRequest";
import type { SeedShopifyOrdersResponse } from "../../shared/responses/SeedShopifyOrdersResponse";
import { ShopifyService } from "../../services/ShopifyService";
import { Logger } from "../../utils/logger";
import { v4 as uuidv4 } from "uuid";
import type { BatchPerformanceMetrics, OrderMetrics, OperationMetrics } from "../../shared/types/PerformanceMetrics";

export class SeedShopifyOrdersUseCase {
  constructor(private readonly shopifyService: ShopifyService) {}

  /**
   * Measure operation duration and return metrics
   */
  private async measureOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<{ result: T; metrics: OperationMetrics }> {
    const startTime = Date.now();
    const result = await operation();
    const durationMs = Date.now() - startTime;

    return {
      result,
      metrics: {
        operation: operationName,
        durationMs,
        apiCallCount: 1, // Each operation is one API call
      },
    };
  }

  async execute(request: SeedShopifyOrdersRequest): Promise<SeedShopifyOrdersResponse> {
    const shopifyOrders: SeedShopifyOrdersResponse["shopifyOrders"] = [];
    const orderMetrics: OrderMetrics[] = [];
    const batchStartTime = Date.now();
    let totalApiCalls = 0;
    let totalRequestedCost = 0;
    let totalActualCost = 0;
    const throttleStatuses: Array<{ currentlyAvailable: number; maximumAvailable: number }> = [];

    // Phase 2: Batch variant lookup - extract all unique SKUs upfront
    const allSkus = new Set<string>();
    for (const orderInput of request.orders) {
      for (const lineItem of orderInput.lineItems) {
        allSkus.add(lineItem.sku);
      }
    }
    const uniqueSkus = Array.from(allSkus);

    // Perform single batched variant lookup for all orders
    Logger.info("Batching variant lookup for all orders", {
      batchId: request.batchId,
      totalOrders: request.orders.length,
      uniqueSkuCount: uniqueSkus.length,
      totalSkuReferences: request.orders.reduce((sum, order) => sum + order.lineItems.length, 0),
    });

    const { result: variantMap, metrics: variantLookupMetrics } = await this.measureOperation(
      "findVariantIdsBySkus",
      () => this.shopifyService.findVariantIdsBySkus(uniqueSkus),
    );

    // Track variant lookup cost if available (from service logging)
    totalApiCalls += variantLookupMetrics.apiCallCount;

    // Process orders sequentially to avoid rate limits
    for (let orderIndex = 0; orderIndex < request.orders.length; orderIndex++) {
      const orderInput = request.orders[orderIndex];
      const orderStartTime = Date.now();

      try {
        // Create draft order (variant map is now pre-fetched and passed in)
        const { result: draftOrderResult, metrics: createMetrics } = await this.measureOperation(
          "createDraftOrder",
          () =>
            this.shopifyService.createDraftOrder(
              {
                customer: orderInput.customer,
                lineItems: orderInput.lineItems,
              },
              request.batchId,
              request.region,
              request.collectionPrepName,
              variantMap, // Pass pre-fetched variant map
            ),
        );

        createMetrics.graphQLCost = draftOrderResult.graphQLCost;
        if (draftOrderResult.graphQLCost) {
          totalRequestedCost += draftOrderResult.graphQLCost.requestedQueryCost;
          totalActualCost += draftOrderResult.graphQLCost.actualQueryCost;
          throttleStatuses.push({
            currentlyAvailable: draftOrderResult.graphQLCost.throttleStatus.currentlyAvailable,
            maximumAvailable: draftOrderResult.graphQLCost.throttleStatus.maximumAvailable,
          });
        }

        // Complete draft order
        const { result: orderResult, metrics: completeMetrics } = await this.measureOperation(
          "completeDraftOrder",
          () => this.shopifyService.completeDraftOrder(draftOrderResult.draftOrderId),
        );

        completeMetrics.graphQLCost = orderResult.graphQLCost;
        if (orderResult.graphQLCost) {
          totalRequestedCost += orderResult.graphQLCost.requestedQueryCost;
          totalActualCost += orderResult.graphQLCost.actualQueryCost;
          throttleStatuses.push({
            currentlyAvailable: orderResult.graphQLCost.throttleStatus.currentlyAvailable,
            maximumAvailable: orderResult.graphQLCost.throttleStatus.maximumAvailable,
          });
        }

        // Note: Orders are created and marked as paid, but NOT fulfilled
        // Fulfillment is not part of the seeding process

        // Query order to get line item IDs
        // Use the same tag format as when creating the order (truncated to 40 chars)
        // Check if line items are available from completeDraftOrder response first
        let lineItems: Array<{ lineItemId: string; sku: string }>;
        let queryMetrics: OperationMetrics;

        if (orderResult.lineItems && orderResult.lineItems.length > 0) {
          // Line items are available in the completion response - no need to query!
          Logger.info("Line items available in draftOrderComplete response, skipping query", {
            orderId: orderResult.orderId,
            lineItemCount: orderResult.lineItems.length,
          });
          lineItems = orderResult.lineItems.map((item) => ({
            lineItemId: item.lineItemId,
            sku: item.sku,
          }));
          queryMetrics = {
            operation: "queryOrdersByTag",
            durationMs: 0,
            apiCallCount: 0, // Skipped
          };
        } else {
          // Need to query for line items
          const batchTag = this.shopifyService.formatBatchTag(request.batchId);
          const { result: orderQueryResults, metrics: queryMetricsResult } = await this.measureOperation(
            "queryOrdersByTag",
            () => this.shopifyService.queryOrdersByTag(batchTag),
          );
          queryMetrics = queryMetricsResult;
          const createdOrder = orderQueryResults.find((o) => o.orderId === orderResult.orderId);

          // In dry-run mode, queryOrdersByTag returns empty array, so construct from input
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
        }

        const orderDurationMs = Date.now() - orderStartTime;
        totalApiCalls += createMetrics.apiCallCount + completeMetrics.apiCallCount + queryMetrics.apiCallCount;

        // Record order metrics
        // Note: variantLookup is batched, so all orders share the same metrics
        // We divide the API call count by number of orders for per-order tracking
        const perOrderVariantMetrics: OperationMetrics = {
          ...variantLookupMetrics,
          apiCallCount: orderIndex === 0 ? variantLookupMetrics.apiCallCount : 0, // Only count once for first order
        };

        orderMetrics.push({
          orderIndex,
          customerEmail: orderInput.customer.email,
          variantLookup: perOrderVariantMetrics,
          draftOrderCreate: createMetrics,
          draftOrderComplete: completeMetrics,
          orderQuery: queryMetrics,
          totalDurationMs: orderDurationMs,
        });

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
          orderIndex,
        });
        throw error; // Re-throw to fail fast - can be changed to continue on error if needed
      }
    }

    const totalDurationMs = Date.now() - batchStartTime;
    const averageOrderDurationMs = orderMetrics.length > 0 ? totalDurationMs / orderMetrics.length : 0;

    // Calculate throttle status summary
    const throttleStatus = throttleStatuses.length > 0
      ? {
          minimumAvailable: Math.min(...throttleStatuses.map((s) => s.currentlyAvailable)),
          maximumAvailable: Math.max(...throttleStatuses.map((s) => s.maximumAvailable)),
          finalAvailable: throttleStatuses[throttleStatuses.length - 1]?.currentlyAvailable ?? 0,
        }
      : {
          minimumAvailable: 0,
          maximumAvailable: 0,
          finalAvailable: 0,
        };

    // Log performance metrics
    const batchMetrics: BatchPerformanceMetrics = {
      totalOrders: request.orders.length,
      totalDurationMs,
      totalApiCalls,
      totalGraphQLCost: {
        requested: totalRequestedCost,
        actual: totalActualCost,
      },
      averageOrderDurationMs,
      orderMetrics,
      throttleStatus,
    };

    Logger.info("Shopify order seeding performance metrics", {
      batchId: request.batchId,
      metrics: batchMetrics,
    });

    return {
      shopifyOrders,
    };
  }
}
