import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfigValidationService } from "./ConfigValidationService";
import { DataValidationService } from "./DataValidationService";
import { PrismaClient } from "@prisma/client";
import type { ConfigDataRepository } from "../repositories/ConfigDataRepository";
import type { SeedConfig } from "../shared/types/SeedConfig";

describe("ConfigValidationService", () => {
  let service: ConfigValidationService;
  let mockPrisma: {
    variant: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    location: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    carriers: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let mockDataRepository: {
    getShopifyVariantId: ReturnType<typeof vi.fn>;
  };
  let mockDataValidationService: {
    validateSeedConfig: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPrisma = {
      variant: {
        findFirst: vi.fn(),
      },
      location: {
        findUnique: vi.fn(),
      },
      carriers: {
        findUnique: vi.fn(),
      },
    };

    mockDataRepository = {
      getShopifyVariantId: vi.fn(),
    };

    mockDataValidationService = {
      validateSeedConfig: vi.fn().mockResolvedValue(undefined),
    };

    service = new ConfigValidationService(
      mockPrisma as unknown as PrismaClient,
      mockDataRepository as unknown as ConfigDataRepository,
      mockDataValidationService as unknown as DataValidationService,
    );
  });

  describe("validateFull", () => {
    it("should return valid result for valid config", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SOFA-001-BLK",
                quantity: 1,
                pickType: "Regular",
              },
            ],
          },
        ],
      };

      mockPrisma.variant.findFirst.mockResolvedValue({
        id: "variant-1",
        sku: "SOFA-001-BLK",
      });

      mockDataRepository.getShopifyVariantId.mockResolvedValue("shopify-id-1");

      const result = await service.validateFull(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return invalid result for invalid schema", async () => {
      const config = {
        orders: [
          {
            customer: {
              name: "Test",
              // Missing email
            },
            lineItems: [],
          },
        ],
      } as unknown as SeedConfig;

      const result = await service.validateFull(config);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("validateShopifyAlignment", () => {
    it("should validate customer email", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test",
              email: "invalid-email",
            },
            lineItems: [
              {
                sku: "SOFA-001-BLK",
                quantity: 1,
                pickType: "Regular",
              },
            ],
          },
        ],
      };

      const result = await service.validateShopifyAlignment(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("email"))).toBe(true);
    });

    it("should validate line items exist", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test",
              email: "test@example.com",
            },
            lineItems: [],
          },
        ],
      };

      const result = await service.validateShopifyAlignment(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("line item"))).toBe(true);
    });

    it("should validate SKU format", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "",
                quantity: 1,
                pickType: "Regular",
              },
            ],
          },
        ],
      };

      const result = await service.validateShopifyAlignment(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("SKU"))).toBe(true);
    });
  });

  describe("validateDatabaseAlignment", () => {
    it("should validate SKUs exist in database", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SOFA-001-BLK",
                quantity: 1,
                pickType: "Regular",
              },
            ],
          },
        ],
      };

      mockPrisma.variant.findFirst.mockResolvedValue(null);

      const result = await service.validateDatabaseAlignment(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("does not exist"))).toBe(true);
    });

    it("should validate collection prep location exists", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SOFA-001-BLK",
                quantity: 1,
                pickType: "Regular",
              },
            ],
          },
        ],
        collectionPrep: {
          carrier: "CANPAR",
          locationId: "invalid",
          region: "CA",
          prepDate: new Date().toISOString(),
        },
      };

      mockPrisma.variant.findFirst.mockResolvedValue({
        id: "variant-1",
        sku: "SOFA-001-BLK",
      });

      mockPrisma.location.findUnique.mockResolvedValue(null);

      const result = await service.validateDatabaseAlignment(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("location"))).toBe(true);
    });

    it("should error if carrier not in database", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SOFA-001-BLK",
                quantity: 1,
                pickType: "Regular",
              },
            ],
          },
        ],
        collectionPrep: {
          carrier: "CANPAR",
          locationId: "langley",
          region: "CA",
          prepDate: new Date().toISOString(),
        },
      };

      mockPrisma.variant.findFirst.mockResolvedValue({
        id: "variant-1",
        sku: "SOFA-001-BLK",
      });

      mockPrisma.location.findUnique.mockResolvedValue({
        id: "langley",
        name: "Langley",
      });

      mockPrisma.carriers.findUnique.mockResolvedValue(null);

      const result = await service.validateDatabaseAlignment(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Carrier"))).toBe(true);
    });
  });
});
