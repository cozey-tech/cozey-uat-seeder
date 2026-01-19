import type { WmsRepository } from "../repositories/interface/WmsRepository";
import { Logger } from "../utils/logger";

export class WmsCleanupServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WmsCleanupServiceError";
    Object.setPrototypeOf(this, WmsCleanupServiceError.prototype);
  }
}

export class WmsCleanupService {
  constructor(
    private readonly wmsRepository: WmsRepository,
    private readonly dryRun: boolean = false,
  ) {}

  async findEntitiesForCleanup(shopifyOrderIds: string[]): Promise<{
    orders: Array<{ shopifyOrderId: string; region: string }>;
    prepCount: number;
    shipmentCount: number;
    collectionPrepIds: Set<string>;
  }> {
    const orders = await this.wmsRepository.findOrdersByShopifyIds(shopifyOrderIds);

    if (orders.length === 0) {
      return {
        orders: [],
        prepCount: 0,
        shipmentCount: 0,
        collectionPrepIds: new Set(),
      };
    }

    const orderIds = orders.map((o) => o.shopifyOrderId);
    const regions = [...new Set(orders.map((o) => o.region))];

    let prepCount = 0;
    const collectionPrepIds = new Set<string>();

    for (const region of regions) {
      const preps = await this.wmsRepository.findPrepsByOrderIds(orderIds, region);
      prepCount += preps.length;

      for (const prep of preps) {
        if (prep.collectionPrepId) {
          collectionPrepIds.add(prep.collectionPrepId);
        }
      }
    }

    const shipments = await this.wmsRepository.findShipmentsByOrderIds(orderIds);

    Logger.debug("Found entities for cleanup", {
      orderCount: orders.length,
      prepCount,
      shipmentCount: shipments.length,
      collectionPrepCount: collectionPrepIds.size,
    });

    return {
      orders: orders.map((o) => ({ shopifyOrderId: o.shopifyOrderId, region: o.region })),
      prepCount,
      shipmentCount: shipments.length,
      collectionPrepIds,
    };
  }

  async deleteOrdersWithEntities(
    shopifyOrderIds: string[],
    onProgress?: (current: number, total: number) => void,
  ): Promise<{
    successful: Array<{
      shopifyOrderId: string;
      deletionCounts: {
        deletedPnpOrderBoxes: number;
        deletedPrepPartItems: number;
        deletedPrepParts: number;
        deletedPreps: number;
        deletedShipments: number;
        deletedVariantOrders: number;
        deletedOrder: boolean;
      };
    }>;
    failed: Array<{ shopifyOrderId: string; error: string }>;
  }> {
    if (this.dryRun) {
      Logger.info("DRY RUN: Would delete WMS entities", {
        orderCount: shopifyOrderIds.length,
      });
      return {
        successful: shopifyOrderIds.map((id) => ({
          shopifyOrderId: id,
          deletionCounts: {
            deletedPnpOrderBoxes: 0,
            deletedPrepPartItems: 0,
            deletedPrepParts: 0,
            deletedPreps: 0,
            deletedShipments: 0,
            deletedVariantOrders: 0,
            deletedOrder: true,
          },
        })),
        failed: [],
      };
    }

    const successful = [];
    const failed = [];
    const total = shopifyOrderIds.length;
    let completed = 0;

    for (const shopifyOrderId of shopifyOrderIds) {
      try {
        const deletionCounts = await this.wmsRepository.deleteOrderEntitiesTransaction(shopifyOrderId);
        successful.push({ shopifyOrderId, deletionCounts });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.error("Failed to delete WMS entities for order", error, { shopifyOrderId });
        failed.push({ shopifyOrderId, error: errorMessage });
      }

      completed++;
      onProgress?.(completed, total);
    }

    return { successful, failed };
  }

  async deleteCollectionPreps(
    collectionPrepIds: Set<string>,
    region: string,
  ): Promise<{
    successful: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    if (this.dryRun) {
      Logger.info("DRY RUN: Would delete collection preps", {
        collectionPrepCount: collectionPrepIds.size,
      });
      return {
        successful: Array.from(collectionPrepIds),
        failed: [],
      };
    }

    const successful = [];
    const failed = [];

    for (const collectionPrepId of collectionPrepIds) {
      try {
        const deleted = await this.wmsRepository.deleteCollectionPrep(collectionPrepId, region);
        if (deleted) {
          successful.push(collectionPrepId);
        } else {
          Logger.info("Collection prep skipped (still referenced)", { collectionPrepId, region });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.error("Failed to delete collection prep", error, { collectionPrepId, region });
        failed.push({ id: collectionPrepId, error: errorMessage });
      }
    }

    return { successful, failed };
  }
}
