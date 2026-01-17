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

    // Process orders sequentially to avoid rate limits
    for (let orderIndex = 0; orderIndex < request.orders.length; orderIndex++) {
      const orderInput = request.orders[orderIndex];
      const orderStartTime = Date.now();

      try {
        // Variant lookup (happens inside createDraftOrder, but we'll track it separately if possible)
        // For now, we track it as part of createDraftOrder since it's called internally
        const variantLookupMetrics: OperationMetrics = {
          operation: "findVariantIdsBySkus",
          durationMs: 0, // Will be part of createDraftOrder timing
          apiCallCount: 1,
        };

        // Create draft order
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
            ),
        );

        // Update variant lookup metrics (it's part of createDraftOrder)
        variantLookupMetrics.durationMs = createMetrics.durationMs * 0.3; // Estimate: variant lookup is ~30% of create time
        variantLookupMetrics.graphQLCost = draftOrderResult.graphQLCost;

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
        orderMetrics.push({
          orderIndex,
          customerEmail: orderInput.customer.email,
          variantLookup: variantLookupMetrics,
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
