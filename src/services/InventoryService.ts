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
   *
   * @param variants - Variants to check (with optional quantity map)
   * @param locationId - Warehouse location ID
   * @param region - Region code
   * @param variantQuantities - Optional map of variant SKU to order quantity (defaults to 1 if not provided)
   */
  async checkInventoryAvailability(
    variants: Variant[],
    locationId: string,
    region: string,
    variantQuantities?: Map<string, number>,
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

      // Get order quantity for this variant (default to 1 if not provided)
      const orderQuantity = variantQuantities?.get(variant.sku) || 1;

      // Calculate required parts: variantPart.quantity * orderQuantity
      const key = variantPart.partId;
      const existing = partRequirements.get(key) || { sku: variantPart.part.sku, required: 0 };
      existing.required += Number(variantPart.quantity) * orderQuantity;
      partRequirements.set(key, existing);
    }

    // Batch check inventory for all parts in a single query
    const partIds = Array.from(partRequirements.keys());
    if (partIds.length > 0) {
      const inventories = await this.prisma.inventory.findMany({
        where: {
          partId: { in: partIds },
          locationId,
          region,
        },
      });

      // Create a map for O(1) lookup
      const inventoryMap = new Map(inventories.map((inv) => [inv.partId, inv]));

      // Check each part requirement against batched inventory results
      for (const [partId, requirement] of partRequirements.entries()) {
        const inventory = inventoryMap.get(partId);

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
    }

    return {
      sufficient: shortages.length === 0,
      shortages,
    };
  }

  /**
   * Modify inventory for a part (staging environments only)
   */
  async modifyInventory(partId: string, locationId: string, region: string, quantity: number): Promise<void> {
    // Check environment - only allow in staging/uat/test
    const config = getEnvConfig();
    const isStaging = this.isStagingEnvironment(config.DATABASE_URL);

    if (!isStaging) {
      throw new Error("Inventory modification is only allowed in staging/uat/test environments");
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
    // We need to get pickType from parts, so we'll use ConfigDataRepository
    // For now, we'll fetch variants and determine pickType
    const skus = order.lineItems.map((item) => item.sku);
    const variantRecords = await this.prisma.variant.findMany({
      where: {
        sku: { in: skus },
        region,
        disabled: false,
      },
    });

    // Batch fetch variant parts for all variants
    const variantIds = variantRecords.map((v) => v.id);
    const allVariantParts = await this.prisma.variantPart.findMany({
      where: {
        variantId: { in: variantIds },
      },
      include: {
        part: {
          select: {
            pickType: true,
          },
        },
      },
    });

    // Group variant parts by variantId
    const variantPartsByVariantId = new Map<string, typeof allVariantParts>();
    for (const vp of allVariantParts) {
      const existing = variantPartsByVariantId.get(vp.variantId) || [];
      existing.push(vp);
      variantPartsByVariantId.set(vp.variantId, existing);
    }

    // Convert to Variant type with pickType (using batched data)
    const variants: Variant[] = variantRecords.map((v) => {
      const variantParts = variantPartsByVariantId.get(v.id) || [];

      let pickType: "Regular" | "Pick and Pack" = "Regular";
      if (variantParts.length > 0) {
        const pickTypeCounts = new Map<string, number>();
        for (const vp of variantParts) {
          const pt = vp.part.pickType;
          pickTypeCounts.set(pt, (pickTypeCounts.get(pt) || 0) + 1);
        }
        let maxCount = 0;
        for (const [pt, count] of pickTypeCounts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            pickType = pt as "Regular" | "Pick and Pack";
          }
        }
      }

      return {
        id: v.id,
        sku: v.sku,
        modelName: v.modelName,
        colorId: v.colorId,
        shopifyIds: v.shopifyIds,
        region: v.region,
        description: v.description,
        pickType,
      };
    });

    // Create map of SKU to quantity from order line items
    // Sum quantities for duplicate SKUs (same SKU can appear in multiple line items)
    const variantQuantities = new Map<string, number>();
    for (const item of order.lineItems) {
      const existingQuantity = variantQuantities.get(item.sku) || 0;
      variantQuantities.set(item.sku, existingQuantity + item.quantity);
    }

    // Check availability with order quantities
    const checkResult = await this.checkInventoryAvailability(variants, locationId, region, variantQuantities);

    // If insufficient, modify inventory to meet requirements
    if (!checkResult.sufficient) {
      for (const shortage of checkResult.shortages) {
        await this.modifyInventory(shortage.partId, locationId, region, shortage.shortfall);
      }

      // Re-check after modification
      return this.checkInventoryAvailability(variants, locationId, region, variantQuantities);
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
