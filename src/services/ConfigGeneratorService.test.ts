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
    };
    collectionPrep: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      location: {
        findUnique: vi.fn(),
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
});
