import { PrismaClient } from "@prisma/client";
import { getEnvConfig } from "../config/env";
import type { Variant } from "../repositories/ConfigDataRepository";
import type { OrderComposition } from "./OrderCompositionBuilder";

export interface InventoryCheckResult {
  sufficient: boolean;
  shortages: Array<{
    partId: string;
    sku: string;
    required: number;
    available: number;
    shortfall: number;
  }>;
}

/**
 * Service for checking and modifying inventory in staging environments
 *
 * Handles:
 * - Checking inventory availability for variants
 * - Calculating available inventory (onHand - openOrders - on_hand_committed)
 * - Modifying inventory in staging/uat/test environments only
 */
export class InventoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check inventory availability for variants at a location
   */
  async checkInventoryAvailability(
    variants: Variant[],
    locationId: string,
    region: string,
  ): Promise<InventoryCheckResult> {
    const shortages: InventoryCheckResult["shortages"] = [];

    // Get all parts needed for these variants
    const variantIds = variants.map((v) => v.id);
    const variantParts = await this.prisma.variantPart.findMany({
      where: {
        variantId: { in: variantIds },
      },
      include: {
        part: true,
        variant: true,
      },
    });

    // Group parts by variant and calculate required quantities
    const partRequirements = new Map<string, { sku: string; required: number }>();

    for (const variantPart of variantParts) {
      const variant = variants.find((v) => v.id === variantPart.variantId);
      if (!variant) continue;

      // For simplicity, assume 1 variant = 1 quantity
      // In real scenario, would need to track quantities per variant
      const key = variantPart.partId;
      const existing = partRequirements.get(key) || { sku: variantPart.part.sku, required: 0 };
      existing.required += Number(variantPart.quantity) || 1;
      partRequirements.set(key, existing);
    }

    // Check inventory for each part
    for (const [partId, requirement] of partRequirements.entries()) {
      const inventory = await this.prisma.inventory.findFirst({
        where: {
          partId,
          locationId,
          region,
        },
      });

      if (!inventory) {
        shortages.push({
          partId,
          sku: requirement.sku,
          required: requirement.required,
          available: 0,
          shortfall: requirement.required,
        });
        continue;
      }

      const available = inventory.onHand - inventory.openOrders - inventory.onHandCommitted;

      if (available < requirement.required) {
        shortages.push({
          partId,
          sku: requirement.sku,
          required: requirement.required,
          available,
          shortfall: requirement.required - available,
        });
      }
    }

    return {
      sufficient: shortages.length === 0,
      shortages,
    };
  }

  /**
   * Modify inventory for a part (staging environments only)
   */
  async modifyInventory(
    partId: string,
    locationId: string,
    region: string,
    quantity: number,
  ): Promise<void> {
    // Check environment - only allow in staging/uat/test
    const config = getEnvConfig();
    const isStaging = this.isStagingEnvironment(config.DATABASE_URL);

    if (!isStaging) {
      throw new Error(
        "Inventory modification is only allowed in staging/uat/test environments",
      );
    }

    // Get current inventory
    const inventory = await this.prisma.inventory.findFirst({
      where: {
        partId,
        locationId,
        region,
      },
    });

    if (!inventory) {
      // Create new inventory record
      await this.prisma.inventory.create({
        data: {
          partId,
          locationId,
          region,
          onHand: quantity,
          openOrders: 0,
          onHandCommitted: 0,
        },
      });
    } else {
      // Update existing inventory
      await this.prisma.inventory.updateMany({
        where: {
          partId,
          locationId,
          region,
        },
        data: {
          onHand: inventory.onHand + quantity,
        },
      });
    }
  }

  /**
   * Ensure inventory is available for an order
   * Checks availability and modifies if needed
   */
  async ensureInventoryForOrder(
    order: OrderComposition,
    locationId: string,
    region: string,
  ): Promise<InventoryCheckResult> {
    // First, get variants for the SKUs in the order
    const skus = order.lineItems.map((item) => item.sku);
    const variants = await this.prisma.variant.findMany({
      where: {
        sku: { in: skus },
        region,
        disabled: false,
      },
    });

    // Check availability
    const checkResult = await this.checkInventoryAvailability(variants, locationId, region);

    // If insufficient, modify inventory to meet requirements
    if (!checkResult.sufficient) {
      for (const shortage of checkResult.shortages) {
        await this.modifyInventory(shortage.partId, locationId, region, shortage.shortfall);
      }

      // Re-check after modification
      return await this.checkInventoryAvailability(variants, locationId, region);
    }

    return checkResult;
  }

  /**
   * Check if database URL indicates staging environment
   */
  private isStagingEnvironment(databaseUrl: string): boolean {
    const url = databaseUrl.toLowerCase();
    return (
      url.includes("staging") ||
      url.includes("uat") ||
      url.includes("test") ||
      url.includes("dev") ||
      url.includes("localhost")
    );
  }
}
