import type { ShopifyService } from "../../services/ShopifyService";
import type { WmsCleanupService } from "../../services/WmsCleanupService";
import type { CleanupRequest } from "../../shared/requests/CleanupRequest";
import type { CleanupResponse } from "../../shared/responses/CleanupResponse";
import { Logger } from "../../utils/logger";

export class CleanupUseCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanupUseCaseError";
    Object.setPrototypeOf(this, CleanupUseCaseError.prototype);
  }
}

export class CleanupUseCase {
  constructor(
    private readonly shopifyService: ShopifyService,
    private readonly wmsCleanupService: WmsCleanupService,
  ) {}

  async execute(request: CleanupRequest): Promise<CleanupResponse> {
    const startTime = Date.now();

    const tag = this.determineTag(request);
    Logger.info("Starting cleanup operation", {
      tag,
      dryRun: request.dryRun,
      skipConfirmation: request.skipConfirmation,
    });

    const shopifyOrders = await this.shopifyService.queryOrdersByTag(tag);

    if (shopifyOrders.length === 0) {
      Logger.warn("No orders found with tag", { tag });
      return {
        shopifyOrders: {
          deleted: [],
          archived: [],
          failed: [],
        },
        wmsEntities: {
          orders: { deleted: 0, failed: 0 },
          preps: { deleted: 0, failed: 0 },
          shipments: { deleted: 0, failed: 0 },
          collectionPreps: { deleted: 0, failed: 0 },
        },
        summary: {
          totalDeleted: 0,
          totalArchived: 0,
          totalFailed: 0,
          durationMs: Date.now() - startTime,
        },
      };
    }

    const shopifyOrderIds = shopifyOrders.map((o) => o.orderId);
    const wmsEntities = await this.wmsCleanupService.findEntitiesForCleanup(shopifyOrderIds);

    Logger.info("Entities found for cleanup", {
      shopifyOrderCount: shopifyOrders.length,
      wmsOrderCount: wmsEntities.orders.length,
      prepCount: wmsEntities.prepCount,
      shipmentCount: wmsEntities.shipmentCount,
      collectionPrepCount: wmsEntities.collectionPrepIds.size,
    });

    if (request.dryRun) {
      return this.buildDryRunResponse(shopifyOrders, wmsEntities, startTime);
    }

    const wmsResults = await this.wmsCleanupService.deleteOrdersWithEntities(shopifyOrderIds, request.onProgress);

    const regionSet = new Set(wmsEntities.orders.map((o) => o.region));
    const collectionPrepResults: { successful: string[]; failed: Array<{ id: string; error: string }> } = {
      successful: [],
      failed: [],
    };

    for (const region of regionSet) {
      const result = await this.wmsCleanupService.deleteCollectionPreps(wmsEntities.collectionPrepIds, region);
      collectionPrepResults.successful.push(...result.successful);
      collectionPrepResults.failed.push(...result.failed);
    }

    const shopifyResults = await this.shopifyService.cleanupOrders(shopifyOrderIds);

    return this.buildResponse(wmsResults, collectionPrepResults, shopifyResults, startTime);
  }

  private determineTag(request: CleanupRequest): string {
    if (request.batchId) {
      return this.shopifyService.formatBatchTag(request.batchId);
    } else if (request.tag) {
      return request.tag;
    }
    throw new CleanupUseCaseError("No tag specified");
  }

  private buildDryRunResponse(
    shopifyOrders: Array<{ orderId: string }>,
    wmsEntities: {
      orders: Array<{ shopifyOrderId: string; region: string }>;
      prepCount: number;
      shipmentCount: number;
      collectionPrepIds: Set<string>;
    },
    startTime: number,
  ): CleanupResponse {
    return {
      shopifyOrders: {
        deleted: shopifyOrders.map((o) => o.orderId),
        archived: [],
        failed: [],
      },
      wmsEntities: {
        orders: { deleted: wmsEntities.orders.length, failed: 0 },
        preps: { deleted: wmsEntities.prepCount, failed: 0 },
        shipments: { deleted: wmsEntities.shipmentCount, failed: 0 },
        collectionPreps: { deleted: wmsEntities.collectionPrepIds.size, failed: 0 },
      },
      summary: {
        totalDeleted: shopifyOrders.length + wmsEntities.orders.length,
        totalArchived: 0,
        totalFailed: 0,
        durationMs: Date.now() - startTime,
      },
    };
  }

  private buildResponse(
    wmsResults: {
      successful: Array<{ shopifyOrderId: string; deletionCounts: unknown }>;
      failed: Array<{ shopifyOrderId: string; error: string }>;
    },
    collectionPrepResults: {
      successful: string[];
      failed: Array<{ id: string; error: string }>;
    },
    shopifyResults: Array<{
      orderId: string;
      method: "deleted" | "archived";
      success: boolean;
      error?: string;
    }>,
    startTime: number,
  ): CleanupResponse {
    const shopifyDeleted = shopifyResults.filter((r) => r.success && r.method === "deleted").map((r) => r.orderId);

    const shopifyArchived = shopifyResults.filter((r) => r.success && r.method === "archived").map((r) => r.orderId);

    const shopifyFailed = shopifyResults
      .filter((r) => !r.success)
      .map((r) => ({
        orderId: r.orderId,
        error: r.error || "Unknown error",
      }));

    return {
      shopifyOrders: {
        deleted: shopifyDeleted,
        archived: shopifyArchived,
        failed: shopifyFailed,
      },
      wmsEntities: {
        orders: {
          deleted: wmsResults.successful.length,
          failed: wmsResults.failed.length,
        },
        preps: {
          deleted: wmsResults.successful.reduce(
            (sum, r) => sum + ((r.deletionCounts as { deletedPreps: number }).deletedPreps || 0),
            0,
          ),
          failed: 0,
        },
        shipments: {
          deleted: wmsResults.successful.reduce(
            (sum, r) => sum + ((r.deletionCounts as { deletedShipments: number }).deletedShipments || 0),
            0,
          ),
          failed: 0,
        },
        collectionPreps: {
          deleted: collectionPrepResults.successful.length,
          failed: collectionPrepResults.failed.length,
        },
      },
      summary: {
        totalDeleted: wmsResults.successful.length + shopifyDeleted.length,
        totalArchived: shopifyArchived.length,
        totalFailed: wmsResults.failed.length + shopifyFailed.length + collectionPrepResults.failed.length,
        durationMs: Date.now() - startTime,
      },
    };
  }
}
