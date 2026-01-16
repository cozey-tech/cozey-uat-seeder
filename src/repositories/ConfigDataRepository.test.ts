import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ConfigDataRepository, type Customer } from "./ConfigDataRepository";
import { readFileSync } from "fs";
import { join } from "path";

// Mock fs module
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

// Mock path module
vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
}));

describe("ConfigDataRepository", () => {
  let repository: ConfigDataRepository;
  let mockPrisma: {
    variant: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
    variantPart: {
      findMany: ReturnType<typeof vi.fn>;
    };
    location: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    carriers: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      variant: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      variantPart: {
        findMany: vi.fn(),
      },
      location: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      carriers: {
        findMany: vi.fn(),
      },
    };

    repository = new ConfigDataRepository(mockPrisma as unknown as PrismaClient);
  });

  describe("getAvailableVariants", () => {
    it("should return variants grouped by model/color", async () => {
      const mockVariants = [
        {
          id: "variant-1",
          sku: "SOFA-001-BLK",
          modelName: "Sofa",
          colorId: "BLK",
          shopifyIds: ["shopify-1"],
          region: "CA",
          description: "Sofa - Black",
        },
        {
          id: "variant-2",
          sku: "SOFA-001-WHT",
          modelName: "Sofa",
          colorId: "WHT",
          shopifyIds: ["shopify-2"],
          region: "CA",
          description: "Sofa - White",
        },
      ];

      mockPrisma.variant.findMany.mockResolvedValue(mockVariants);
      // Mock variantPart.findMany for pickType lookup (called for each variant)
      mockPrisma.variantPart.findMany
        .mockResolvedValueOnce([
          {
            variantId: "variant-1",
            part: { pickType: "Regular" },
          },
        ])
        .mockResolvedValueOnce([
          {
            variantId: "variant-2",
            part: { pickType: "Regular" },
          },
        ]);

      const result = await repository.getAvailableVariants("CA");

      expect(result).toHaveLength(2);
      expect(result[0].sku).toBe("SOFA-001-BLK");
      expect(result[0].pickType).toBe("Regular");
      expect(result[1].sku).toBe("SOFA-001-WHT");
      expect(result[1].pickType).toBe("Regular");
      expect(mockPrisma.variant.findMany).toHaveBeenCalledWith({
        where: {
          region: "CA",
          disabled: false,
        },
        select: {
          id: true,
          sku: true,
          modelName: true,
          colorId: true,
          shopifyIds: true,
          region: true,
          description: true,
        },
        orderBy: [
          { modelName: "asc" },
          { colorId: "asc" },
          { description: "asc" },
          { sku: "asc" },
        ],
      });
    });

    it("should filter out disabled variants", async () => {
      mockPrisma.variant.findMany.mockResolvedValue([]);

      await repository.getAvailableVariants("CA");

      expect(mockPrisma.variant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            disabled: false,
          }),
        }),
      );
    });
  });

  describe("getCustomers", () => {
    it("should load customers from config file", async () => {
      const mockCustomers: Customer[] = [
        {
          id: "customer-1",
          name: "Test Customer",
          email: "test@example.com",
          region: "CA",
          locationId: "langley",
        },
      ];

      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ customers: mockCustomers }),
      );
      vi.mocked(join).mockReturnValue("config/customers.json");

      const result = await repository.getCustomers();

      expect(result).toEqual(mockCustomers);
      expect(readFileSync).toHaveBeenCalledWith("config/customers.json", "utf-8");
    });

    it("should throw error if file not found", async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        const error = new Error("ENOENT");
        (error as { code?: string }).code = "ENOENT";
        throw error;
      });

      await expect(repository.getCustomers()).rejects.toThrow(
        "Customers config file not found at config/customers.json",
      );
    });

    it("should throw error if customer missing locationId", async () => {
      const invalidCustomers = [
        {
          id: "customer-1",
          name: "Test Customer",
          email: "test@example.com",
          region: "CA",
        },
      ];

      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ customers: invalidCustomers }),
      );

      await expect(repository.getCustomers()).rejects.toThrow(
        "Customer customer-1 is missing locationId",
      );
    });
  });

  describe("getLocations", () => {
    it("should return locations for region", async () => {
      const mockLocations = [
        {
          id: "langley",
          name: "Langley",
          region: "CA",
          provinces: ["BC"],
        },
      ];

      mockPrisma.location.findMany.mockResolvedValue(mockLocations);

      const result = await repository.getLocations("CA");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("langley");
      expect(mockPrisma.location.findMany).toHaveBeenCalledWith({
        where: { region: "CA" },
        select: {
          id: true,
          name: true,
          region: true,
          provinces: true,
        },
        orderBy: { name: "asc" },
      });
    });
  });

  describe("getCarriers", () => {
    it("should return carriers from database", async () => {
      const mockCarriers = [
        {
          id: "CANPAR",
          name: "Canpar",
          region: "CA",
        },
      ];

      mockPrisma.carriers.findMany.mockResolvedValue(mockCarriers);

      const result = await repository.getCarriers("CA");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("CANPAR");
    });

    it("should return hardcoded carriers if database is empty", async () => {
      mockPrisma.carriers.findMany.mockResolvedValue([]);

      const result = await repository.getCarriers("CA");

      expect(result).toHaveLength(4);
      expect(result.map((c) => c.id)).toContain("CANPAR");
      expect(result.map((c) => c.id)).toContain("FEDEX");
    });
  });

  describe("getLocationForCustomer", () => {
    it("should return location for customer", async () => {
      const customer: Customer = {
        id: "customer-1",
        name: "Test",
        email: "test@example.com",
        region: "CA",
        locationId: "langley",
      };

      const mockLocation = {
        id: "langley",
        name: "Langley",
        region: "CA",
        provinces: ["BC"],
      };

      mockPrisma.location.findUnique.mockResolvedValue(mockLocation);

      const result = await repository.getLocationForCustomer(customer);

      expect(result).not.toBeNull();
      expect(result?.id).toBe("langley");
      expect(mockPrisma.location.findUnique).toHaveBeenCalledWith({
        where: {
          id_region: {
            id: "langley",
            region: "CA",
          },
        },
        select: {
          id: true,
          name: true,
          region: true,
          provinces: true,
        },
      });
    });

    it("should return null if customer has no locationId", async () => {
      const customer: Customer = {
        id: "customer-1",
        name: "Test",
        email: "test@example.com",
        region: "CA",
        locationId: "",
      };

      const result = await repository.getLocationForCustomer(customer);

      expect(result).toBeNull();
    });

    it("should return null if location not found", async () => {
      const customer: Customer = {
        id: "customer-1",
        name: "Test",
        email: "test@example.com",
        region: "CA",
        locationId: "invalid",
      };

      mockPrisma.location.findUnique.mockResolvedValue(null);

      const result = await repository.getLocationForCustomer(customer);

      expect(result).toBeNull();
    });
  });

  describe("getShopifyVariantId", () => {
    it("should extract Shopify variant ID from array", async () => {
      mockPrisma.variant.findFirst.mockResolvedValue({
        shopifyIds: ["gid://shopify/ProductVariant/123"],
      });

      const result = await repository.getShopifyVariantId("SOFA-001-BLK", "CA");

      expect(result).toBe("gid://shopify/ProductVariant/123");
      expect(mockPrisma.variant.findFirst).toHaveBeenCalledWith({
        where: {
          sku: "SOFA-001-BLK",
          region: "CA",
          disabled: false,
        },
        select: {
          shopifyIds: true,
        },
      });
    });

    it("should return null if variant not found", async () => {
      mockPrisma.variant.findFirst.mockResolvedValue(null);

      const result = await repository.getShopifyVariantId("INVALID-SKU", "CA");

      expect(result).toBeNull();
    });

    it("should return null if shopifyIds array is empty", async () => {
      mockPrisma.variant.findFirst.mockResolvedValue({
        shopifyIds: [],
      });

      const result = await repository.getShopifyVariantId("SOFA-001-BLK", "CA");

      expect(result).toBeNull();
    });
  });
});
