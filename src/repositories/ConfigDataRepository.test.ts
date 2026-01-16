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
      // Mock variantPart.findMany for pickType lookup (batched query for all variants)
      // The query returns all variantParts for all variants, grouped by variantId in code
      mockPrisma.variantPart.findMany.mockResolvedValue([
        {
          variantId: "variant-1",
          partId: "part-1",
          quantity: 1,
          part: { pickType: "Regular" },
        },
        {
          variantId: "variant-2",
          partId: "part-2",
          quantity: 1,
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
          shopifyIds: {
            isEmpty: false,
          },
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
      // Verify batched variantPart query was called
      expect(mockPrisma.variantPart.findMany).toHaveBeenCalledWith({
        where: {
          variantId: { in: ["variant-1", "variant-2"] },
        },
        include: {
          part: {
            select: {
              pickType: true,
            },
          },
        },
      });
    });

    it("should filter out disabled variants", async () => {
      mockPrisma.variant.findMany.mockResolvedValue([]);
      // When no variants, variantPart.findMany should still be called with empty array
      mockPrisma.variantPart.findMany.mockResolvedValue([]);

      await repository.getAvailableVariants("CA");

      expect(mockPrisma.variant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            disabled: false,
            shopifyIds: {
              isEmpty: false,
            },
          }),
        }),
      );
      // Verify variantPart query was called (even with empty variant list)
      expect(mockPrisma.variantPart.findMany).toHaveBeenCalledWith({
        where: {
          variantId: { in: [] },
        },
        include: {
          part: {
            select: {
              pickType: true,
            },
          },
        },
      });
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
    it("should return carriers from enum filtered by region", async () => {
      const result = await repository.getCarriers("CA");

      // Should include carriers with region: null (available for all regions)
      // and carriers with region: "CA"
      expect(result.length).toBeGreaterThan(0);
      
      // Check that Canpar (region: null) is included
      const canpar = result.find((c) => c.id === "Canpar");
      expect(canpar).toBeDefined();
      expect(canpar?.name).toBe("Canpar");
      
      // Check that GoBoltMontreal (region: "CA") is included
      const goBoltMontreal = result.find((c) => c.id === "GoBoltMontreal");
      expect(goBoltMontreal).toBeDefined();
      expect(goBoltMontreal?.name).toBe("Go Bolt Montreal");
    });

    it("should filter out carriers not available for the specified region", async () => {
      const resultCA = await repository.getCarriers("CA");
      const resultUS = await repository.getCarriers("US");

      // GoBoltMontreal should only be in CA results
      const goBoltMontrealCA = resultCA.find((c) => c.id === "GoBoltMontreal");
      const goBoltMontrealUS = resultUS.find((c) => c.id === "GoBoltMontreal");
      
      expect(goBoltMontrealCA).toBeDefined();
      expect(goBoltMontrealUS).toBeUndefined();

      // GoBoltNewYorkCity should only be in US results
      const goBoltNYCCA = resultCA.find((c) => c.id === "GoBoltNewYorkCity");
      const goBoltNYCUS = resultUS.find((c) => c.id === "GoBoltNewYorkCity");
      
      expect(goBoltNYCCA).toBeUndefined();
      expect(goBoltNYCUS).toBeDefined();
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
