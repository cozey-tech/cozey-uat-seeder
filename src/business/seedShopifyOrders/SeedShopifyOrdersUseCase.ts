import type { SeedShopifyOrdersRequest } from "../../shared/requests/SeedShopifyOrdersRequest";
import type { SeedShopifyOrdersResponse } from "../../shared/responses/SeedShopifyOrdersResponse";
import { ShopifyService } from "../../services/ShopifyService";
import { Logger } from "../../utils/logger";
import { v4 as uuidv4 } from "uuid";
import type { BatchPerformanceMetrics, OrderMetrics, OperationMetrics } from "../../shared/types/PerformanceMetrics";
import pLimit from "p-limit";

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
    // Validate input
    if (request.orders.length === 0) {
      throw new Error("Cannot seed orders: orders array is empty");
    }

    const operationId = Logger.startOperation("seedShopifyOrders", {
      batchId: request.batchId,
      orderCount: request.orders.length,
      region: request.region,
    });

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

    // Validate that all SKUs were found before processing orders
    const missingSkus = uniqueSkus.filter((sku) => !variantMap.has(sku));
    if (missingSkus.length > 0) {
      throw new Error(
        `Variant lookup failed for ${missingSkus.length} SKU(s): ${missingSkus.join(", ")}. ` +
        `Cannot proceed with order creation. Please verify SKUs exist in Shopify.`,
      );
    }

    // Track variant lookup cost if available (from service logging)
    totalApiCalls += variantLookupMetrics.apiCallCount;

    // Phase 4: Process orders in parallel with controlled concurrency
    // Start with 10 concurrent orders (adjust based on GraphQL cost limits)
    // Cost-aware: Monitor throttle status and adjust if needed
    const CONCURRENT_ORDERS = 10;
    const COST_THRESHOLD_LOW = 200; // If available cost drops below this, reduce concurrency
    const limit = pLimit(CONCURRENT_ORDERS);

    Logger.info("Processing orders in parallel", {
      batchId: request.batchId,
      totalOrders: request.orders.length,
      concurrentOrders: CONCURRENT_ORDERS,
      costThresholdLow: COST_THRESHOLD_LOW,
    });

    // Track errors for continue-on-error strategy
    const errors: Array<{ orderIndex: number; customerEmail: string; error: Error }> = [];

    // Process orders in parallel (operations within each order remain sequential)
    const orderPromises = request.orders.map((orderInput, orderIndex) =>
      limit(async () => {
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
          // Need to query for line items - use single order query (more efficient than querying all by tag)
          const { result: createdOrder, metrics: queryMetricsResult } = await this.measureOperation(
            "queryOrderById",
            () => this.shopifyService.queryOrderById(orderResult.orderId),
          );
          queryMetrics = queryMetricsResult;

          // In dry-run mode, queryOrderById returns null, so construct from input
          if (!createdOrder) {
            // This happens in dry-run mode - construct line items from input
            // In normal mode, this would indicate a problem (order not found after creation)
            Logger.warn("Order not found when querying by ID, constructing line items from input", {
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

        // Record order metrics
        // Note: variantLookup is batched, so all orders share the same metrics
        // We divide the API call count by number of orders for per-order tracking
        const perOrderVariantMetrics: OperationMetrics = {
          ...variantLookupMetrics,
          apiCallCount: orderIndex === 0 ? variantLookupMetrics.apiCallCount : 0, // Only count once for first order
        };

          // Notify progress callback of success
          if (request.onOrderProgress) {
            request.onOrderProgress(orderIndex + 1, request.orders.length, orderInput.customer.email, true);
          }

          return {
            success: true as const,
            order: {
              shopifyOrderId: orderResult.orderId,
              shopifyOrderNumber: orderResult.orderNumber,
              lineItems,
              fulfillmentStatus: "UNFULFILLED" as const, // Orders are not fulfilled during seeding
            },
            metrics: {
              orderIndex,
              customerEmail: orderInput.customer.email,
              variantLookup: perOrderVariantMetrics,
              draftOrderCreate: createMetrics,
              draftOrderComplete: completeMetrics,
              orderQuery: queryMetrics,
              totalDurationMs: orderDurationMs,
            },
          };
        } catch (error) {
          // Continue-on-error strategy: collect errors, don't fail entire batch
          const errorMessage = error instanceof Error ? error.message : String(error);
          Logger.error("Failed to create Shopify order", error, {
            batchId: request.batchId,
            customerEmail: orderInput.customer.email,
            orderIndex,
          });

          errors.push({
            orderIndex,
            customerEmail: orderInput.customer.email,
            error: error instanceof Error ? error : new Error(errorMessage),
          });

          // Notify progress callback of failure
          if (request.onOrderProgress) {
            request.onOrderProgress(orderIndex + 1, request.orders.length, orderInput.customer.email, false);
          }

          return {
            success: false as const,
            orderIndex,
            customerEmail: orderInput.customer.email,
            error: errorMessage,
          };
        }
      }),
    );

    // Wait for all orders to complete (successful or failed)
    const results = await Promise.all(orderPromises);

    // Separate successful orders from failures
    for (const result of results) {
      if (result.success) {
        shopifyOrders.push(result.order);
        orderMetrics.push(result.metrics);
        totalApiCalls +=
          result.metrics.draftOrderCreate.apiCallCount +
          result.metrics.draftOrderComplete.apiCallCount +
          result.metrics.orderQuery.apiCallCount;

        // Track GraphQL cost from successful orders
        // Cost-aware rate limiting: monitor and warn if cost gets low
        if (result.metrics.draftOrderCreate.graphQLCost) {
          totalRequestedCost += result.metrics.draftOrderCreate.graphQLCost.requestedQueryCost;
          totalActualCost += result.metrics.draftOrderCreate.graphQLCost.actualQueryCost;
          const available = result.metrics.draftOrderCreate.graphQLCost.throttleStatus.currentlyAvailable;
          throttleStatuses.push({
            currentlyAvailable: available,
            maximumAvailable: result.metrics.draftOrderCreate.graphQLCost.throttleStatus.maximumAvailable,
          });

          // Warn if cost is getting low (cost-aware backoff signal)
          if (available < COST_THRESHOLD_LOW) {
            Logger.warn("GraphQL cost is low, consider reducing concurrency", {
              batchId: request.batchId,
              orderIndex: result.metrics.orderIndex,
              currentlyAvailable: available,
              threshold: COST_THRESHOLD_LOW,
            });
          }
        }
        if (result.metrics.draftOrderComplete.graphQLCost) {
          totalRequestedCost += result.metrics.draftOrderComplete.graphQLCost.requestedQueryCost;
          totalActualCost += result.metrics.draftOrderComplete.graphQLCost.actualQueryCost;
          const available = result.metrics.draftOrderComplete.graphQLCost.throttleStatus.currentlyAvailable;
          throttleStatuses.push({
            currentlyAvailable: available,
            maximumAvailable: result.metrics.draftOrderComplete.graphQLCost.throttleStatus.maximumAvailable,
          });

          // Warn if cost is getting low
          if (available < COST_THRESHOLD_LOW) {
            Logger.warn("GraphQL cost is low, consider reducing concurrency", {
              batchId: request.batchId,
              orderIndex: result.metrics.orderIndex,
              currentlyAvailable: available,
              threshold: COST_THRESHOLD_LOW,
            });
          }
        }
      }
    }

    // Log errors if any occurred
    if (errors.length > 0) {
      Logger.warn("Some orders failed during parallel processing", {
        batchId: request.batchId,
        failedCount: errors.length,
        totalOrders: request.orders.length,
        successfulCount: shopifyOrders.length,
        errors: errors.map((e) => ({
          orderIndex: e.orderIndex,
          customerEmail: e.customerEmail,
          error: e.error.message,
        })),
      });

      // If all orders failed, throw an error
      if (errors.length === request.orders.length) {
        throw new Error(
          `All ${request.orders.length} orders failed. First error: ${errors[0]?.error.message}`,
        );
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

    Logger.performance({
      operation: "seedShopifyOrders",
      duration: totalDurationMs,
      itemCount: request.orders.length,
      successfulCount: shopifyOrders.length,
      failedCount: errors.length,
      totalApiCalls,
      totalRequestedCost,
      totalActualCost,
      averageOrderDurationMs,
    });

    Logger.info("Shopify order seeding performance metrics", {
      batchId: request.batchId,
      metrics: batchMetrics,
    });

    const result = {
      shopifyOrders,
      failures: errors.length > 0
        ? errors.map((e) => ({
            orderIndex: e.orderIndex,
            customerEmail: e.customerEmail,
            error: e.error.message,
          }))
        : undefined,
    };

    Logger.endOperation(operationId, errors.length === 0, {
      successfulOrders: shopifyOrders.length,
      failedOrders: errors.length,
      totalApiCalls,
    });

    return result;
  }
}
