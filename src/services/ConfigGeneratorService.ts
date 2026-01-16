import type { SeedConfig } from "../shared/types/SeedConfig";
import type { Customer, Carrier } from "../repositories/ConfigDataRepository";
import type { OrderComposition } from "./OrderCompositionBuilder";
import { PrismaClient } from "@prisma/client";

export interface GenerateConfigOptions {
  orders: Array<{
    customer: Customer;
    composition: OrderComposition;
    locationId: string;
  }>;
  collectionPrepCount: number;
  carrier: Carrier;
  prepDate: Date;
  region: string;
}

/**
 * Service for generating SeedConfig from collected data
 *
 * Handles:
 * - Converting order compositions to SeedConfig format
 * - Allocating orders to collection preps
 * - Generating collection prep IDs using pattern format
 * - Determining location IDs from customers
 */
export class ConfigGeneratorService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Generate SeedConfig from options
   */
  async generateConfig(options: GenerateConfigOptions): Promise<SeedConfig> {
    const orders: SeedConfig["orders"] = options.orders.map((order) => ({
      customer: {
        name: order.customer.name,
        email: order.customer.email,
      },
      lineItems: order.composition.lineItems.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
        pickType: item.pickType,
        hasBarcode: item.hasBarcode,
      })),
    }));

    // Determine order types based on line items
    for (const order of orders) {
      const pickTypes = new Set(order.lineItems.map((item) => item.pickType));
      if (pickTypes.size === 1) {
        if (pickTypes.has("Regular")) {
          order.orderType = "regular-only";
        } else {
          order.orderType = "pnp-only";
        }
      } else {
        order.orderType = "mixed";
      }
    }

    // Generate collection prep configuration if needed
    let collectionPrep: SeedConfig["collectionPrep"] | undefined;
    if (options.collectionPrepCount > 0) {
      // Validate all orders have the same locationId for collection prep
      const locationIds = new Set(options.orders.map((o) => o.locationId).filter(Boolean));
      if (locationIds.size > 1) {
        throw new Error(
          `Cannot create collection prep: orders have different locationIds: ${Array.from(locationIds).join(", ")}`,
        );
      }

      const locationId = options.orders[0]?.locationId || "";
      if (!locationId) {
        throw new Error("Cannot create collection prep: no locationId found in orders");
      }

      // Allocate orders to collection preps (for future use)
      this.allocateOrdersToCollectionPreps(orders.length, options.collectionPrepCount);

      // Generate collection prep IDs (for future use)
      await this.generateCollectionPrepIds(
        options.collectionPrepCount,
        options.carrier.id,
        locationId,
        options.prepDate,
        options.region,
      );

      // For now, we'll create one collection prep with all orders
      // The actual allocation to multiple preps would be handled during seeding
      collectionPrep = {
        carrier: options.carrier.id,
        locationId,
        region: options.region,
        prepDate: options.prepDate.toISOString(),
      };
    }

    return {
      region: options.region as "CA" | "US",
      orders,
      collectionPrep,
    };
  }

  /**
   * Allocate orders evenly across collection preps
   * Returns array of order indices for each collection prep
   */
  allocateOrdersToCollectionPreps(
    orderCount: number,
    collectionPrepCount: number,
  ): number[][] {
    if (collectionPrepCount === 0) {
      return [];
    }

    const allocation: number[][] = Array.from({ length: collectionPrepCount }, () => []);

    for (let i = 0; i < orderCount; i++) {
      const prepIndex = i % collectionPrepCount;
      allocation[prepIndex].push(i);
    }

    return allocation;
  }

  /**
   * Generate collection prep IDs using pattern format:
   * ${MMDDYY}${locationFirstLastLetter}${CARRIER}${count}
   *
   * Example: 010724WRCANPAR1 (Jan 7, 2024, Windsor, Canpar, #1)
   *
   * Note: This method has a race condition if multiple processes generate IDs simultaneously.
   * The IDs are generated based on existing preps at query time, so concurrent runs may
   * generate duplicate IDs. The database unique constraint on collectionPrep.id will catch
   * duplicates, but the seeding process will fail. For production use, consider:
   * - Using database transactions with row-level locking
   * - Adding retry logic with exponential backoff
   * - Using a distributed lock (e.g., Redis) for ID generation
   * - Generating IDs at seeding time instead of config generation time
   */
  async generateCollectionPrepIds(
    count: number,
    carrier: string,
    locationId: string,
    prepDate: Date,
    region: string,
  ): Promise<string[]> {
    // Get location name to extract first and last letter
    const location = await this.prisma.location.findUnique({
      where: {
        id_region: {
          id: locationId,
          region,
        },
      },
      select: {
        name: true,
      },
    });

    if (!location) {
      throw new Error(`Location ${locationId} not found for region ${region}`);
    }

    // Extract first and last letter from location name
    const locationAbbrev = this.getLocationAbbreviation(location.name);

    // Format date as MMDDYY
    const month = String(prepDate.getMonth() + 1).padStart(2, "0");
    const day = String(prepDate.getDate()).padStart(2, "0");
    const year = String(prepDate.getFullYear()).slice(-2);
    const dateStr = `${month}${day}${year}`;

    // Check existing collection preps to determine count
    // Note: This query is not atomic with ID generation, creating a race condition window.
    // For staging/UAT use, this is acceptable, but be aware of the limitation.
    const existingPreps = await this.prisma.collectionPrep.findMany({
      where: {
        region,
        locationId,
        carrier,
        prepDate: {
          gte: new Date(prepDate.getFullYear(), prepDate.getMonth(), prepDate.getDate()),
          lt: new Date(
            prepDate.getFullYear(),
            prepDate.getMonth(),
            prepDate.getDate() + 1,
          ),
        },
      },
      select: {
        id: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    // Extract count from existing IDs to determine next count
    const existingCounts = existingPreps
      .map((prep) => {
        const match = prep.id.match(/\d+$/);
        return match ? parseInt(match[0], 10) : 0;
      })
      .filter((c) => c > 0);

    const startCount = existingCounts.length > 0 ? Math.max(...existingCounts) + 1 : 1;

    // Generate IDs
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const currentCount = startCount + i;
      const id = `${dateStr}${locationAbbrev}${carrier}${currentCount}`;
      ids.push(id);
    }

    return ids;
  }

  /**
   * Get location abbreviation (first + last letter)
   * Example: "Windsor" -> "WR", "Langley" -> "LY"
   */
  private getLocationAbbreviation(locationName: string): string {
    const cleaned = locationName.trim().toUpperCase();
    if (cleaned.length === 0) {
      throw new Error("Location name cannot be empty");
    }
    if (cleaned.length === 1) {
      return cleaned + cleaned;
    }
    return cleaned[0] + cleaned[cleaned.length - 1];
  }
}
