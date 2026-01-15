import { describe, expect, it, vi, beforeEach } from "vitest";

import { CollectionPrepService, CollectionPrepValidationError } from "./CollectionPrepService";
import type { WmsRepository } from "../repositories/interface/WmsRepository";
import type { SeedConfig } from "../shared/types/SeedConfig";
import { OrderType } from "../shared/enums/OrderType";
import { PickType } from "../shared/enums/PickType";

describe("CollectionPrepService", () => {
  let mockRepository: WmsRepository;
  let service: CollectionPrepService;

  beforeEach(() => {
    mockRepository = {
      createCollectionPrep: vi.fn(),
      createOrder: vi.fn(),
      createVariantOrder: vi.fn(),
      createPrep: vi.fn(),
      createShipment: vi.fn(),
      createPnpPackageInfo: vi.fn(),
      createPnpBox: vi.fn(),
      createPnpOrderBox: vi.fn(),
      createPrepPart: vi.fn(),
      createPrepPartItem: vi.fn(),
      findPartBySku: vi.fn(),
      findPartsBySkus: vi.fn(),
      findVariantBySku: vi.fn(),
      findVariantsBySkus: vi.fn(),
      findCustomerById: vi.fn(),
      findCustomerByEmail: vi.fn(),
      findOrderByShopifyId: vi.fn(),
      createCustomer: vi.fn(),
      createOrderWithCustomerTransaction: vi.fn(),
      createOrderEntitiesTransaction: vi.fn(),
    };
    service = new CollectionPrepService(mockRepository);
  });

  describe("createCollectionPrep", () => {
    it("should create collection prep via repository", async () => {
      const request = {
        id: "cp-123",
        region: "CA",
        carrier: "UPS",
        locationId: "loc-123",
        prepDate: new Date("2026-01-15"),
        boxes: 5,
      };

      const expectedResult = {
        id: "cp-123",
        region: "CA",
        carrier: "UPS",
        locationId: "loc-123",
        prepDate: new Date("2026-01-15"),
        boxes: 5,
      };

      vi.mocked(mockRepository.createCollectionPrep).mockResolvedValue(expectedResult);

      const result = await service.createCollectionPrep(request);

      expect(result).toEqual(expectedResult);
      expect(mockRepository.createCollectionPrep).toHaveBeenCalledWith(request);
    });
  });

  describe("validateOrderMix", () => {
    it("should pass validation for valid regular-only order", () => {
      const config: SeedConfig = {
        collectionPrep: {
          carrier: "UPS",
          locationId: "loc-123",
          region: "CA",
          prepDate: "2026-01-15T10:00:00Z",
        },
        orders: [
          {
            orderType: OrderType.RegularOnly,
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

      expect(() => service.validateOrderMix(config, ["order-1"])).not.toThrow();
    });

    it("should pass validation for valid pnp-only order", () => {
      const config: SeedConfig = {
        collectionPrep: {
          carrier: "UPS",
          locationId: "loc-123",
          region: "CA",
          prepDate: "2026-01-15T10:00:00Z",
        },
        orders: [
          {
            orderType: OrderType.PnpOnly,
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

      expect(() => service.validateOrderMix(config, ["order-1"])).not.toThrow();
    });

    it("should pass validation for valid mixed order", () => {
      const config: SeedConfig = {
        collectionPrep: {
          carrier: "UPS",
          locationId: "loc-123",
          region: "CA",
          prepDate: "2026-01-15T10:00:00Z",
        },
        orders: [
          {
            orderType: OrderType.Mixed,
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
                sku: "SKU-002",
                quantity: 1,
                pickType: PickType.PickAndPack,
              },
            ],
          },
        ],
      };

      expect(() => service.validateOrderMix(config, ["order-1"])).not.toThrow();
    });

    it("should throw error for regular-only order with PnP items", () => {
      const config: SeedConfig = {
        collectionPrep: {
          carrier: "UPS",
          locationId: "loc-123",
          region: "CA",
          prepDate: "2026-01-15T10:00:00Z",
        },
        orders: [
          {
            orderType: OrderType.RegularOnly,
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: PickType.PickAndPack, // Wrong type
              },
            ],
          },
        ],
      };

      expect(() => service.validateOrderMix(config, ["order-1"])).toThrow(
        CollectionPrepValidationError,
      );
      expect(() => service.validateOrderMix(config, ["order-1"])).toThrow(
        "is declared as 'regular-only' but contains Pick and Pack items",
      );
    });

    it("should throw error for pnp-only order with regular items", () => {
      const config: SeedConfig = {
        collectionPrep: {
          carrier: "UPS",
          locationId: "loc-123",
          region: "CA",
          prepDate: "2026-01-15T10:00:00Z",
        },
        orders: [
          {
            orderType: OrderType.PnpOnly,
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: PickType.Regular, // Wrong type
              },
            ],
          },
        ],
      };

      expect(() => service.validateOrderMix(config, ["order-1"])).toThrow(
        CollectionPrepValidationError,
      );
      expect(() => service.validateOrderMix(config, ["order-1"])).toThrow(
        "is declared as 'pnp-only' but contains Regular items",
      );
    });

    it("should throw error for mixed order without both types", () => {
      const config: SeedConfig = {
        collectionPrep: {
          carrier: "UPS",
          locationId: "loc-123",
          region: "CA",
          prepDate: "2026-01-15T10:00:00Z",
        },
        orders: [
          {
            orderType: OrderType.Mixed,
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: PickType.Regular, // Only one type
              },
            ],
          },
        ],
      };

      expect(() => service.validateOrderMix(config, ["order-1"])).toThrow(
        CollectionPrepValidationError,
      );
      expect(() => service.validateOrderMix(config, ["order-1"])).toThrow(
        "is declared as 'mixed' but does not contain both Regular and Pick and Pack items",
      );
    });

    it("should skip validation when collectionPrep is not specified", () => {
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

      expect(() => service.validateOrderMix(config, ["order-1"])).not.toThrow();
    });
  });
});
