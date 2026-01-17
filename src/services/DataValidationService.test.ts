import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

import { DataValidationService, DataValidationError } from "./DataValidationService";
import type { SeedConfig } from "../shared/types/SeedConfig";
import { PickType } from "../shared/enums/PickType";

describe("DataValidationService", () => {
  let mockPrisma: {
    variant: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  let service: DataValidationService;

  beforeEach(() => {
    mockPrisma = {
      variant: {
        findMany: vi.fn(),
      },
    };
    service = new DataValidationService(mockPrisma as unknown as PrismaClient);
  });

  describe("validateSeedConfig", () => {
    it("should pass validation for valid config with existing SKUs", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: PickType.Regular,
              },
            ],
          },
        ],
      };

      mockPrisma.variant.findMany.mockResolvedValue([
        { sku: "SKU-001" },
      ]);

      await expect(service.validateSeedConfig(config)).resolves.not.toThrow();
    });

    it("should throw DataValidationError for missing SKUs", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: PickType.Regular,
              },
              {
                sku: "SKU-MISSING",
                quantity: 1,
                pickType: PickType.Regular,
              },
            ],
          },
        ],
      };

      mockPrisma.variant.findMany.mockResolvedValue([
        { sku: "SKU-001" },
      ]);

      await expect(service.validateSeedConfig(config)).rejects.toThrow(DataValidationError);
      await expect(service.validateSeedConfig(config)).rejects.toThrow("Missing SKUs in WMS");
    });

    it("should throw DataValidationError for invalid customer data", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "", // Empty name
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: PickType.Regular,
              },
            ],
          },
        ],
      };

      mockPrisma.variant.findMany.mockResolvedValue([
        { sku: "SKU-001" },
      ]);

      await expect(service.validateSeedConfig(config)).rejects.toThrow(DataValidationError);
      await expect(service.validateSeedConfig(config)).rejects.toThrow("Customer name is required");
    });

    it("should throw DataValidationError for invalid quantities", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 0, // Invalid quantity
                pickType: PickType.Regular,
              },
            ],
          },
        ],
      };

      mockPrisma.variant.findMany.mockResolvedValue([
        { sku: "SKU-001" },
      ]);

      await expect(service.validateSeedConfig(config)).rejects.toThrow(DataValidationError);
      await expect(service.validateSeedConfig(config)).rejects.toThrow("Quantity must be positive");
    });

    it("should allow PnP items without pnpConfig (boxes exist in database)", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: PickType.PickAndPack,
              },
            ],
          },
        ],
      };

      mockPrisma.variant.findMany.mockResolvedValue([
        { sku: "SKU-001" },
      ]);

      // Should not throw - pnpConfig is optional since boxes exist in database
      await expect(service.validateSeedConfig(config)).resolves.toBeUndefined();
    });

    it("should throw DataValidationError if pnpConfig is provided but incomplete", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: PickType.PickAndPack,
              },
            ],
          },
        ],
        pnpConfig: {
          packageInfo: [], // Empty - should fail
          boxes: [
            {
              identifier: "BOX-1",
              dimensions: { length: 12, width: 12, height: 12 },
            },
          ],
        },
      };

      mockPrisma.variant.findMany.mockResolvedValue([
        { sku: "SKU-001" },
      ]);

      await expect(service.validateSeedConfig(config)).rejects.toThrow(DataValidationError);
      await expect(service.validateSeedConfig(config)).rejects.toThrow("packageInfo");
    });

    it("should validate PnP config when PnP items are present", async () => {
      const config: SeedConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: PickType.PickAndPack,
              },
            ],
          },
        ],
        pnpConfig: {
          packageInfo: [
            {
              identifier: "PKG-001",
              dimensions: { length: 10, width: 8, height: 6 },
              weight: 1.5,
            },
          ],
          boxes: [
            {
              identifier: "BOX-001",
              dimensions: { length: 12, width: 10, height: 8 },
            },
          ],
        },
      };

      mockPrisma.variant.findMany.mockResolvedValue([
        { sku: "SKU-001" },
      ]);

      await expect(service.validateSeedConfig(config)).resolves.not.toThrow();
    });
  });
});
