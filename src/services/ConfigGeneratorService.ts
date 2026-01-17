import type { SeedConfig } from "../shared/types/SeedConfig";
import type { Customer, Carrier } from "../repositories/ConfigDataRepository";
import type { OrderComposition } from "./OrderCompositionBuilder";
import { PrismaClient } from "@prisma/client";
import { processWithConcurrency } from "../utils/concurrency";

export interface CollectionPrepConfig {
  carrier: Carrier;
  locationId: string;
  prepDate: Date;
  testTag?: string;
  orderIndices?: number[]; // Optional: specific orders to assign to this prep
}

export interface GenerateConfigOptions {
  orders: Array<{
    customer: Customer;
    composition: OrderComposition;
    locationId: string;
  }>;
  collectionPreps?: CollectionPrepConfig[]; // Array of collection prep configs (new)
  // Legacy support for single collection prep
  collectionPrepCount?: number;
  carrier?: Carrier;
  prepDate?: Date;
  region: string;
  testTag?: string;
  pnpConfig?: SeedConfig["pnpConfig"];
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
        address: order.customer.address,
        city: order.customer.city,
        province: order.customer.province,
        postalCode: order.customer.postalCode,
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

    // Generate collection prep configuration(s) if needed
    let collectionPreps: SeedConfig["collectionPreps"] | undefined;
    let collectionPrep: SeedConfig["collectionPrep"] | undefined; // Legacy support

    // New approach: array of collection preps
    if (options.collectionPreps && options.collectionPreps.length > 0) {
      // Generate collection prep IDs in parallel (batched location lookups + parallelized generation)
      // Note: IDs are generated but not stored in config - they're used for validation/future seeding
      await this.generateCollectionPrepIdsBatch(
        options.collectionPreps,
        options.region,
        5, // Concurrency limit: 5 parallel ID generations
      );

      // Build collection prep configs
      collectionPreps = options.collectionPreps.map((prepConfig) => ({
        carrier: prepConfig.carrier.id,
        locationId: prepConfig.locationId,
        region: options.region,
        prepDate: prepConfig.prepDate.toISOString(),
        testTag: prepConfig.testTag,
      }));
    }
    // Legacy approach: single collection prep
    else if (options.collectionPrepCount && options.collectionPrepCount > 0) {
      if (!options.carrier || !options.prepDate) {
        throw new Error(
          "Carrier and prepDate are required when collectionPrepCount > 0",
        );
      }

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
        testTag: options.testTag,
      };
    }

    // Include pnpConfig only if explicitly provided
    // Note: Boxes already exist in the database, so pnpConfig is optional
    const pnpConfig: SeedConfig["pnpConfig"] | undefined = options.pnpConfig;

    return {
      region: options.region as "CA" | "US",
      orders,
      collectionPreps,
      collectionPrep, // Legacy support
      pnpConfig,
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
   * Generate collection prep IDs for multiple collection preps in parallel
   * Batches location lookups and parallelizes ID generation
   *
   * @param configs - Array of collection prep configurations
   * @param region - Region code
   * @param concurrencyLimit - Maximum concurrent ID generations (default: 5)
   * @returns Map of collection prep config index to generated ID
   */
  async generateCollectionPrepIdsBatch(
    configs: CollectionPrepConfig[],
    region: string,
    concurrencyLimit: number = 5,
  ): Promise<Map<number, string>> {
    if (configs.length === 0) {
      return new Map();
    }

    // Batch location lookups: group by locationId to avoid duplicate queries
    const uniqueLocationIds = Array.from(new Set(configs.map((c) => c.locationId)));
    const locations = await this.prisma.location.findMany({
      where: {
        id: { in: uniqueLocationIds },
        region,
      },
      select: {
        id: true,
        name: true,
      },
    });

    const locationMap = new Map(locations.map((l) => [l.id, l]));

    // Generate IDs in parallel using concurrency control
    const results = await processWithConcurrency(
      configs.map((config, index) => ({ config, index })),
      async ({ config, index }) => {
        const location = locationMap.get(config.locationId);
        if (!location) {
          throw new Error(
            `Location ${config.locationId} not found for region ${region}`,
          );
        }

        // Generate single ID for this collection prep
        const ids = await this.generateCollectionPrepIds(
          1,
          config.carrier.id,
          config.locationId,
          config.prepDate,
          region,
        );

        return { index, id: ids[0] };
      },
      concurrencyLimit,
    );

    // Build result map
    const idMap = new Map<number, string>();
    for (const { index, id } of results) {
      idMap.set(index, id);
    }

    return idMap;
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
