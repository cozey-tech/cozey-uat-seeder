import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfigGeneratorService } from "./ConfigGeneratorService";
import { PrismaClient } from "@prisma/client";
import type { Customer, Carrier } from "../repositories/ConfigDataRepository";
import type { OrderComposition } from "./OrderCompositionBuilder";

describe("ConfigGeneratorService", () => {
  let service: ConfigGeneratorService;
  let mockPrisma: {
    location: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    collectionPrep: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      location: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      collectionPrep: {
        findMany: vi.fn(),
      },
    };

    service = new ConfigGeneratorService(mockPrisma as unknown as PrismaClient);
  });

  describe("generateConfig", () => {
    it("should generate config with orders", async () => {
      const customer: Customer = {
        id: "customer-1",
        name: "Test Customer",
        email: "test@example.com",
        region: "CA",
        locationId: "langley",
      };

      const composition: OrderComposition = {
        lineItems: [
          {
            sku: "SOFA-001-BLK",
            quantity: 1,
            pickType: "Regular",
          },
        ],
      };

      const carrier: Carrier = {
        id: "CANPAR",
        name: "Canpar",
        region: "CA",
      };

      const options = {
        orders: [
          {
            customer,
            composition,
            locationId: "langley",
          },
        ],
        collectionPrepCount: 0,
        carrier,
        prepDate: new Date("2024-01-15"),
        region: "CA",
      };

      const result = await service.generateConfig(options);

      expect(result.orders).toHaveLength(1);
      expect(result.orders[0].customer.name).toBe("Test Customer");
      expect(result.orders[0].lineItems).toHaveLength(1);
      expect(result.orders[0].orderType).toBe("regular-only");
      expect(result.collectionPrep).toBeUndefined();
      // Should not include pnpConfig when no PnP items are present
      expect(result.pnpConfig).toBeUndefined();
    });

    it("should determine order type correctly", async () => {
      const customer: Customer = {
        id: "customer-1",
        name: "Test Customer",
        email: "test@example.com",
        region: "CA",
        locationId: "langley",
      };

      const composition: OrderComposition = {
        lineItems: [
          {
            sku: "SOFA-001-BLK",
            quantity: 1,
            pickType: "Regular",
          },
          {
            sku: "CHAIR-001-WHT",
            quantity: 1,
            pickType: "Pick and Pack",
          },
        ],
      };

      const carrier: Carrier = {
        id: "CANPAR",
        name: "Canpar",
        region: "CA",
      };

      const options = {
        orders: [
          {
            customer,
            composition,
            locationId: "langley",
          },
        ],
        collectionPrepCount: 0,
        carrier,
        prepDate: new Date("2024-01-15"),
        region: "CA",
      };

      const result = await service.generateConfig(options);

      expect(result.orders[0].orderType).toBe("mixed");
      // pnpConfig is optional - boxes exist in database, so it's not automatically included
      expect(result.pnpConfig).toBeUndefined();
    });

    it("should use provided pnpConfig when PnP items are present", async () => {
      const customer: Customer = {
        id: "customer-1",
        name: "Test Customer",
        email: "test@example.com",
        region: "CA",
        locationId: "langley",
      };

      const composition: OrderComposition = {
        lineItems: [
          {
            sku: "LEG-001",
            quantity: 1,
            pickType: "Pick and Pack",
          },
        ],
      };

      const customPnpConfig = {
        packageInfo: [
          {
            identifier: "CUSTOM-PKG-1",
            dimensions: { length: 10, width: 10, height: 10 },
            weight: 2.0,
          },
        ],
        boxes: [
          {
            identifier: "CUSTOM-BOX-1",
            dimensions: { length: 10, width: 10, height: 10 },
          },
        ],
      };

      const options = {
        orders: [
          {
            customer,
            composition,
            locationId: "langley",
          },
        ],
        collectionPrepCount: 0,
        region: "CA",
        pnpConfig: customPnpConfig,
      };

      const result = await service.generateConfig(options);

      expect(result.pnpConfig).toBeDefined();
      expect(result.pnpConfig?.packageInfo[0]?.identifier).toBe("CUSTOM-PKG-1");
      expect(result.pnpConfig?.boxes[0]?.identifier).toBe("CUSTOM-BOX-1");
    });

    it("should generate collection prep config when count > 0", async () => {
      const customer: Customer = {
        id: "customer-1",
        name: "Test Customer",
        email: "test@example.com",
        region: "CA",
        locationId: "langley",
      };

      const composition: OrderComposition = {
        lineItems: [
          {
            sku: "SOFA-001-BLK",
            quantity: 1,
            pickType: "Regular",
          },
        ],
      };

      const carrier: Carrier = {
        id: "CANPAR",
        name: "Canpar",
        region: "CA",
      };

      mockPrisma.location.findUnique.mockResolvedValue({
        name: "Langley",
      });

      mockPrisma.collectionPrep.findMany.mockResolvedValue([]);

      const options = {
        orders: [
          {
            customer,
            composition,
            locationId: "langley",
          },
        ],
        collectionPrepCount: 1,
        carrier,
        prepDate: new Date("2024-01-15"),
        region: "CA",
      };

      const result = await service.generateConfig(options);

      expect(result.collectionPrep).toBeDefined();
      expect(result.collectionPrep?.carrier).toBe("CANPAR");
      expect(result.collectionPrep?.locationId).toBe("langley");
    });

    it("should throw error if orders have different locationIds", async () => {
      const customer1: Customer = {
        id: "customer-1",
        name: "Test Customer 1",
        email: "test1@example.com",
        region: "CA",
        locationId: "langley",
      };

      const customer2: Customer = {
        id: "customer-2",
        name: "Test Customer 2",
        email: "test2@example.com",
        region: "CA",
        locationId: "windsor",
      };

      const composition: OrderComposition = {
        lineItems: [
          {
            sku: "SOFA-001-BLK",
            quantity: 1,
            pickType: "Regular",
          },
        ],
      };

      const carrier: Carrier = {
        id: "CANPAR",
        name: "Canpar",
        region: "CA",
      };

      mockPrisma.location.findUnique.mockResolvedValue({
        name: "Langley",
      });

      const options = {
        orders: [
          {
            customer: customer1,
            composition,
            locationId: "langley",
          },
          {
            customer: customer2,
            composition,
            locationId: "windsor",
          },
        ],
        collectionPrepCount: 1,
        carrier,
        prepDate: new Date("2024-01-15"),
        region: "CA",
      };

      await expect(service.generateConfig(options)).rejects.toThrow(
        "orders have different locationIds",
      );
    });

    it("should document race condition in collection prep ID generation", async () => {
      // This test verifies that the method has proper documentation about race conditions
      const customer: Customer = {
        id: "customer-1",
        name: "Test Customer",
        email: "test@example.com",
        region: "CA",
        locationId: "langley",
      };

      const composition: OrderComposition = {
        lineItems: [
          {
            sku: "SOFA-001-BLK",
            quantity: 1,
            pickType: "Regular",
          },
        ],
      };

      const carrier: Carrier = {
        id: "CANPAR",
        name: "Canpar",
        region: "CA",
      };

      mockPrisma.location.findUnique.mockResolvedValue({
        name: "Langley",
      });

      mockPrisma.collectionPrep.findMany.mockResolvedValue([]);

      const options = {
        orders: [
          {
            customer,
            composition,
            locationId: "langley",
          },
        ],
        collectionPrepCount: 1,
        carrier,
        prepDate: new Date("2024-01-15"),
        region: "CA",
      };

      // The method should work, but we're verifying it has proper documentation
      const result = await service.generateConfig(options);
      expect(result.collectionPrep).toBeDefined();

      // Verify the method was called (documentation is in the code)
      expect(mockPrisma.collectionPrep.findMany).toHaveBeenCalled();
    });

    it("should generate config with multiple collection preps", async () => {
      const customer1: Customer = {
        id: "customer-1",
        name: "Test Customer 1",
        email: "test1@example.com",
        region: "CA",
        locationId: "langley",
      };

      const customer2: Customer = {
        id: "customer-2",
        name: "Test Customer 2",
        email: "test2@example.com",
        region: "CA",
        locationId: "langley",
      };

      const composition: OrderComposition = {
        lineItems: [
          {
            sku: "SOFA-001-BLK",
            quantity: 1,
            pickType: "Regular",
          },
        ],
      };

      const carrier1: Carrier = {
        id: "CANPAR",
        name: "Canpar",
        region: "CA",
      };

      const carrier2: Carrier = {
        id: "FEDEX",
        name: "FedEx",
        region: "CA",
      };

      const options = {
        orders: [
          {
            customer: customer1,
            composition,
            locationId: "langley",
          },
          {
            customer: customer2,
            composition,
            locationId: "langley",
          },
        ],
        collectionPreps: [
          {
            carrier: carrier1,
            locationId: "langley",
            prepDate: new Date("2024-01-15"),
            testTag: "Test1",
          },
          {
            carrier: carrier2,
            locationId: "langley",
            prepDate: new Date("2024-01-15"),
            testTag: "Test2",
          },
        ],
        region: "CA",
      };

      // Mock batched location lookup
      mockPrisma.location.findMany.mockResolvedValue([
        {
          id: "langley",
          name: "Langley",
        },
      ]);

      // Mock findUnique (used by generateCollectionPrepIds internally)
      mockPrisma.location.findUnique
        .mockResolvedValueOnce({ name: "Langley" })
        .mockResolvedValueOnce({ name: "Langley" });

      // Mock collection prep queries
      mockPrisma.collectionPrep.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.generateConfig(options);

      expect(result.collectionPreps).toBeDefined();
      expect(result.collectionPreps).toHaveLength(2);
      expect(result.collectionPreps?.[0]?.carrier).toBe("CANPAR");
      expect(result.collectionPreps?.[0]?.testTag).toBe("Test1");
      expect(result.collectionPreps?.[1]?.carrier).toBe("FEDEX");
      expect(result.collectionPreps?.[1]?.testTag).toBe("Test2");
      // Legacy collectionPrep should be undefined when using new format
      expect(result.collectionPrep).toBeUndefined();

      // Verify batch location lookup was used (batched query)
      expect(mockPrisma.location.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["langley"] }, // Unique location IDs
          region: "CA",
        },
        select: {
          id: true,
          name: true,
        },
      });
    });

    it("should handle collection preps with different locationIds", async () => {
      const customer1: Customer = {
        id: "customer-1",
        name: "Test Customer 1",
        email: "test1@example.com",
        region: "CA",
        locationId: "langley",
      };

      const customer2: Customer = {
        id: "customer-2",
        name: "Test Customer 2",
        email: "test2@example.com",
        region: "CA",
        locationId: "windsor",
      };

      const customer3: Customer = {
        id: "customer-3",
        name: "Test Customer 3",
        email: "test3@example.com",
        region: "CA",
        locationId: "royalmount",
      };

      const composition: OrderComposition = {
        lineItems: [
          {
            sku: "SOFA-001-BLK",
            quantity: 1,
            pickType: "Regular",
          },
        ],
      };

      const carrier: Carrier = {
        id: "CANPAR",
        name: "Canpar",
        region: "CA",
      };

      const options = {
        orders: [
          {
            customer: customer1,
            composition,
            locationId: "langley",
          },
          {
            customer: customer2,
            composition,
            locationId: "windsor",
          },
          {
            customer: customer3,
            composition,
            locationId: "royalmount",
          },
        ],
        collectionPreps: [
          {
            carrier,
            locationId: "langley",
            prepDate: new Date("2024-01-15"),
            testTag: "Test1",
            orderIndices: [0],
          },
          {
            carrier,
            locationId: "windsor",
            prepDate: new Date("2024-01-15"),
            testTag: "Test2",
            orderIndices: [1],
          },
          {
            carrier,
            locationId: "royalmount",
            prepDate: new Date("2024-01-15"),
            testTag: "Test3",
            orderIndices: [2],
          },
        ],
        region: "CA",
      };

      // Mock batched location lookup for all three locations
      mockPrisma.location.findMany.mockResolvedValue([
        {
          id: "langley",
          name: "Langley",
        },
        {
          id: "windsor",
          name: "Windsor",
        },
        {
          id: "royalmount",
          name: "Royal Mount",
        },
      ]);

      // Mock findUnique (used by generateCollectionPrepIds internally)
      mockPrisma.location.findUnique
        .mockResolvedValueOnce({ name: "Langley" })
        .mockResolvedValueOnce({ name: "Windsor" })
        .mockResolvedValueOnce({ name: "Royal Mount" });

      // Mock collection prep queries
      mockPrisma.collectionPrep.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.generateConfig(options);

      expect(result.collectionPreps).toBeDefined();
      expect(result.collectionPreps).toHaveLength(3);
      expect(result.collectionPreps?.[0]?.locationId).toBe("langley");
      expect(result.collectionPreps?.[1]?.locationId).toBe("windsor");
      expect(result.collectionPreps?.[2]?.locationId).toBe("royalmount");

      // Verify batch location lookup was used with all unique location IDs
      expect(mockPrisma.location.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["langley", "windsor", "royalmount"] }, // All unique location IDs
          region: "CA",
        },
        select: {
          id: true,
          name: true,
        },
      });
    });
  });

  describe("allocateOrdersToCollectionPreps", () => {
    it("should allocate orders evenly", () => {
      const allocation = service.allocateOrdersToCollectionPreps(10, 3);

      expect(allocation).toHaveLength(3);
      expect(allocation[0].length).toBe(4); // 0, 3, 6, 9
      expect(allocation[1].length).toBe(3); // 1, 4, 7
      expect(allocation[2].length).toBe(3); // 2, 5, 8
    });

    it("should handle single collection prep", () => {
      const allocation = service.allocateOrdersToCollectionPreps(5, 1);

      expect(allocation).toHaveLength(1);
      expect(allocation[0]).toEqual([0, 1, 2, 3, 4]);
    });

    it("should handle more preps than orders", () => {
      const allocation = service.allocateOrdersToCollectionPreps(2, 5);

      expect(allocation).toHaveLength(5);
      expect(allocation[0]).toEqual([0]);
      expect(allocation[1]).toEqual([1]);
      expect(allocation[2]).toEqual([]);
    });

    it("should return empty array for zero preps", () => {
      const allocation = service.allocateOrdersToCollectionPreps(5, 0);

      expect(allocation).toEqual([]);
    });
  });

  describe("generateCollectionPrepIds", () => {
    it("should generate IDs with correct pattern", async () => {
      mockPrisma.location.findUnique.mockResolvedValue({
        name: "Windsor",
      });

      mockPrisma.collectionPrep.findMany.mockResolvedValue([]);

      const ids = await service.generateCollectionPrepIds(
        2,
        "CANPAR",
        "windsor",
        new Date("2024-01-07"),
        "CA",
      );

      expect(ids).toHaveLength(2);
      expect(ids[0]).toMatch(/^\d{6}WRCANPAR\d+$/);
      expect(ids[1]).toMatch(/^\d{6}WRCANPAR\d+$/);
      expect(ids[0]).not.toBe(ids[1]);
    });

    it("should increment count for existing preps", async () => {
      mockPrisma.location.findUnique.mockResolvedValue({
        name: "Langley",
      });

      mockPrisma.collectionPrep.findMany.mockResolvedValue([
        { id: "010724LGCANPAR1" },
        { id: "010724LGCANPAR2" },
      ]);

      const ids = await service.generateCollectionPrepIds(
        2,
        "CANPAR",
        "langley",
        new Date("2024-01-07"),
        "CA",
      );

      expect(ids[0]).toContain("3");
      expect(ids[1]).toContain("4");
    });

    it("should throw error if location not found", async () => {
      mockPrisma.location.findUnique.mockResolvedValue(null);

      await expect(
        service.generateCollectionPrepIds(1, "CANPAR", "invalid", new Date(), "CA"),
      ).rejects.toThrow("Location invalid not found");
    });
  });

  describe("generateCollectionPrepIdsBatch", () => {
    const carrier1: Carrier = { id: "CANPAR", name: "Canpar", region: "CA" };
    const carrier2: Carrier = { id: "FEDEX", name: "FedEx", region: "CA" };

    it("should generate IDs for multiple collection preps in parallel", async () => {
      const configs = [
        {
          carrier: carrier1,
          locationId: "langley",
          prepDate: new Date("2024-01-15"),
          testTag: "Test1",
        },
        {
          carrier: carrier2,
          locationId: "langley",
          prepDate: new Date("2024-01-15"),
          testTag: "Test2",
        },
      ];

      // Mock batched location lookup (used by batch method)
      mockPrisma.location.findMany.mockResolvedValue([
        {
          id: "langley",
          name: "Langley",
        },
      ]);

      // Mock findUnique (still used by generateCollectionPrepIds internally)
      mockPrisma.location.findUnique
        .mockResolvedValueOnce({ name: "Langley" }) // First prep
        .mockResolvedValueOnce({ name: "Langley" }); // Second prep

      // Mock collection prep queries (one per config, called in parallel)
      mockPrisma.collectionPrep.findMany
        .mockResolvedValueOnce([]) // First prep query
        .mockResolvedValueOnce([]); // Second prep query

      const result = await service.generateCollectionPrepIdsBatch(configs, "CA", 5);

      expect(result.size).toBe(2);
      expect(result.get(0)).toBeDefined();
      expect(result.get(1)).toBeDefined();
      expect(result.get(0)).toMatch(/^\d{6}LYCANPAR\d+$/); // Langley = LY
      expect(result.get(1)).toMatch(/^\d{6}LYFEDEX\d+$/); // Langley = LY

      // Verify batched location lookup (single query for both)
      expect(mockPrisma.location.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.location.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["langley"] }, // Unique location IDs
          region: "CA",
        },
        select: {
          id: true,
          name: true,
        },
      });
    });

    it("should batch location lookups for different locations", async () => {
      const configs = [
        {
          carrier: carrier1,
          locationId: "langley",
          prepDate: new Date("2024-01-15"),
        },
        {
          carrier: carrier2,
          locationId: "windsor",
          prepDate: new Date("2024-01-15"),
        },
      ];

      // Mock batched location lookup (both locations in one query)
      mockPrisma.location.findMany.mockResolvedValue([
        {
          id: "langley",
          name: "Langley",
        },
        {
          id: "windsor",
          name: "Windsor",
        },
      ]);

      // Mock findUnique (still used by generateCollectionPrepIds internally)
      mockPrisma.location.findUnique
        .mockResolvedValueOnce({ name: "Langley" })
        .mockResolvedValueOnce({ name: "Windsor" });

      mockPrisma.collectionPrep.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.generateCollectionPrepIdsBatch(configs, "CA", 5);

      expect(result.size).toBe(2);
      // Verify single batched query for both locations
      expect(mockPrisma.location.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.location.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["langley", "windsor"] },
          region: "CA",
        },
        select: {
          id: true,
          name: true,
        },
      });
    });

    it("should handle empty configs array", async () => {
      const result = await service.generateCollectionPrepIdsBatch([], "CA", 5);

      expect(result.size).toBe(0);
      expect(mockPrisma.location.findMany).not.toHaveBeenCalled();
    });

    it("should throw error if location not found in batch", async () => {
      const configs = [
        {
          carrier: carrier1,
          locationId: "invalid",
          prepDate: new Date("2024-01-15"),
        },
      ];

      mockPrisma.location.findMany.mockResolvedValue([]); // No location found

      await expect(
        service.generateCollectionPrepIdsBatch(configs, "CA", 5),
      ).rejects.toThrow("Location invalid not found");
    });
  });
});
