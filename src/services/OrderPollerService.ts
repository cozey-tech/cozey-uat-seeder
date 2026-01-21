import type { WmsRepository } from "../repositories/interface/WmsRepository";
import { Logger } from "../utils/logger";

export class WebhookTimeoutError extends Error {
  constructor(
    message: string,
    public readonly missingOrderIds: string[],
  ) {
    super(message);
    this.name = "WebhookTimeoutError";
    Object.setPrototypeOf(this, WebhookTimeoutError.prototype);
  }
}

export interface PollingOptions {
  timeout: number; // milliseconds (default: 180_000 = 3 minutes)
  pollInterval: number; // milliseconds (default: 5_000 = 5 seconds)
  onProgress?: (found: number, total: number, elapsed: number) => void;
  allowPartialSuccess?: boolean; // If true, don't throw on partial timeout
}

export interface PollingResult {
  foundOrders: Array<{
    shopifyOrderId: string;
    wmsOrderId: string;
    preps: Array<{ prepId: string; lineItemId: string }>;
  }>;
  missingOrders: string[];
  partialSuccess: boolean;
}

/**
 * Service for polling WMS database until COS webhook has ingested Shopify orders
 *
 * After creating orders in Shopify, COS webhook listens and creates all required
 * WMS entities (order, prep, prepPart, customer, etc.). This service polls the WMS
 * database until those orders appear, indicating successful webhook ingestion.
 *
 * Typical ingestion time: 1-2 minutes
 * Default timeout: 3 minutes (provides buffer)
 */
export class OrderPollerService {
  constructor(private readonly wmsRepository: WmsRepository) {}

  /**
   * Poll WMS database until all Shopify orders have been ingested by COS webhook
   *
   * @param shopifyOrderIds - Shopify order IDs to wait for
   * @param options - Polling configuration
   * @returns Orders found and their associated preps created by COS
   * @throws WebhookTimeoutError if timeout reached and no orders found (total failure)
   */
  async pollForOrders(shopifyOrderIds: string[], options: PollingOptions): Promise<PollingResult> {
    const startTime = Date.now();
    const foundOrders = new Map<string, { wmsOrderId: string; preps: Array<{ prepId: string; lineItemId: string }> }>();

    Logger.info("Starting webhook polling", {
      shopifyOrderCount: shopifyOrderIds.length,
      timeoutSeconds: options.timeout / 1000,
      pollIntervalSeconds: options.pollInterval / 1000,
    });

    while (foundOrders.size < shopifyOrderIds.length) {
      const elapsed = Date.now() - startTime;

      // Check timeout
      if (elapsed > options.timeout) {
        const missing = shopifyOrderIds.filter((id) => !foundOrders.has(id));

        if (foundOrders.size === 0) {
          // Total failure: no orders found
          Logger.error("Webhook polling timeout - no orders found", {
            timeoutMs: options.timeout,
            elapsedMs: elapsed,
            missingOrderCount: missing.length,
          });
          throw new WebhookTimeoutError(
            `Webhook timeout after ${options.timeout}ms. No orders found in WMS. COS webhook may be down.`,
            missing,
          );
        } else if (options.allowPartialSuccess) {
          // Partial success: some orders found
          Logger.warn("Webhook polling partial success", {
            foundCount: foundOrders.size,
            missingCount: missing.length,
            missingIds: missing,
            timeoutMs: options.timeout,
          });
          return this.buildPollingResult(foundOrders, missing, true);
        } else {
          // Fail on partial success (strict mode)
          Logger.error("Webhook polling timeout - partial success", {
            foundCount: foundOrders.size,
            missingCount: missing.length,
            missingIds: missing,
            timeoutMs: options.timeout,
          });
          throw new WebhookTimeoutError(
            `Webhook timeout after ${options.timeout}ms. Found ${foundOrders.size}/${shopifyOrderIds.length} orders.`,
            missing,
          );
        }
      }

      // Check for each missing order
      for (const shopifyOrderId of shopifyOrderIds) {
        if (!foundOrders.has(shopifyOrderId)) {
          const order = await this.wmsRepository.findOrderByShopifyId(shopifyOrderId);

          // Debug: Log what we found
          if (order) {
            Logger.debug("Order found in WMS", {
              shopifyOrderId,
              wmsOrderId: order.id,
              status: order.status,
              customerId: order.customerId,
            });
          } else {
            Logger.debug("Order not yet in WMS", { shopifyOrderId });
          }

          // If order exists, check if COS webhook created preps for it
          if (order) {
            // Query preps created by COS for this order
            const preps = await this.wmsRepository.findPrepsByOrderIds([shopifyOrderId], order.region);

            Logger.debug("Checking preps for order", {
              shopifyOrderId,
              wmsOrderId: order.id,
              prepCount: preps.length,
            });

            // Order is considered "ingested" when preps exist (COS webhook completed)
            if (preps.length > 0) {
              Logger.debug("Order ingested by webhook", {
                shopifyOrderId,
                wmsOrderId: order.id,
                prepCount: preps.length,
              });

              foundOrders.set(shopifyOrderId, {
                wmsOrderId: order.id,
                preps: preps
                  .filter((prep) => prep.lineItemId) // Only include preps with line item IDs
                  .map((prep) => ({
                    prepId: prep.prep,
                    lineItemId: prep.lineItemId!,
                  })),
              });

              Logger.info("Order and preps found", {
                shopifyOrderId,
                wmsOrderId: order.id,
                prepCount: preps.length,
              });
            }
          }
        }
      }

      // Progress callback
      options.onProgress?.(foundOrders.size, shopifyOrderIds.length, elapsed);

      // Sleep before next poll (unless all found)
      if (foundOrders.size < shopifyOrderIds.length) {
        await this.sleep(options.pollInterval);
      }
    }

    Logger.info("All orders ingested by COS webhook", {
      orderCount: foundOrders.size,
      totalElapsedMs: Date.now() - startTime,
    });

    return this.buildPollingResult(foundOrders, [], false);
  }

  private buildPollingResult(
    foundOrders: Map<string, { wmsOrderId: string; preps: Array<{ prepId: string; lineItemId: string }> }>,
    missingOrders: string[],
    partialSuccess: boolean,
  ): PollingResult {
    return {
      foundOrders: Array.from(foundOrders.entries()).map(([shopifyOrderId, data]) => ({
        shopifyOrderId,
        wmsOrderId: data.wmsOrderId,
        preps: data.preps,
      })),
      missingOrders,
      partialSuccess,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
