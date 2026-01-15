import { describe, expect, it, vi, beforeEach } from "vitest";

import { WmsService, WmsServiceError } from "./WmsService";
import type { WmsRepository } from "../repositories/interface/WmsRepository";

describe("WmsService", () => {
  let mockRepository: WmsRepository;
  let service: WmsService;

  beforeEach(() => {
    mockRepository = {
      createOrder: vi.fn(),
      createVariantOrder: vi.fn(),
      createPrep: vi.fn(),
      createCollectionPrep: vi.fn(),
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
    } as unknown as WmsRepository;
    service = new WmsService(mockRepository);
  });

  describe("createOrderWithCustomer", () => {
    it("should return existing order if it already exists (idempotency)", async () => {
      const existingOrder = {
        id: "order-123",
        shopifyOrderId: "gid://shopify/Order/456",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      };

      vi.mocked(mockRepository.findOrderByShopifyId).mockResolvedValue(existingOrder);

      const result = await service.createOrderWithCustomer(
        "gid://shopify/Order/456",
        "#1001",
        "fulfilled",
        "CA",
        "Test Customer",
        "test@example.com",
      );

      expect(result.orderDbId).toBe("order-123");
      expect(result.shopifyOrderId).toBe("gid://shopify/Order/456");
      expect(mockRepository.createOrder).not.toHaveBeenCalled();
    });

    it("should find existing customer by email and create order", async () => {
      const existingCustomer = {
        id: "customer-123",
        name: "Test Customer",
        email: "test@example.com",
      };

      vi.mocked(mockRepository.findOrderByShopifyId).mockResolvedValue(null);
      vi.mocked(mockRepository.findCustomerByEmail).mockResolvedValue(existingCustomer);
      vi.mocked(mockRepository.createOrder).mockResolvedValue({
        id: "order-123",
        shopifyOrderId: "gid://shopify/Order/456",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      });

      const result = await service.createOrderWithCustomer(
        "gid://shopify/Order/456",
        "#1001",
        "fulfilled",
        "CA",
        "Test Customer",
        "test@example.com",
      );

      expect(result.customerId).toBe("customer-123");
      expect(mockRepository.findCustomerByEmail).toHaveBeenCalledWith("test@example.com", "CA");
      expect(mockRepository.createCustomer).not.toHaveBeenCalled();
    });

    it("should create new customer and order in transaction if customer doesn't exist", async () => {
      vi.mocked(mockRepository.findOrderByShopifyId).mockResolvedValue(null);
      vi.mocked(mockRepository.findCustomerByEmail).mockResolvedValue(null);
      vi.mocked(mockRepository.createOrderWithCustomerTransaction).mockResolvedValue({
        order: {
          id: "order-123",
          shopifyOrderId: "gid://shopify/Order/456",
          shopifyOrderNumber: "#1001",
          status: "fulfilled",
          region: "CA",
        },
        customerId: "customer-123",
      });

      const result = await service.createOrderWithCustomer(
        "gid://shopify/Order/456",
        "#1001",
        "fulfilled",
        "CA",
        "Test Customer",
        "test@example.com",
      );

      expect(result.orderDbId).toBe("order-123");
      expect(result.customerId).toBe("customer-123");
      expect(mockRepository.createOrderWithCustomerTransaction).toHaveBeenCalled();
    });
  });

  describe("createVariantOrdersForOrder", () => {
    it("should batch lookup variants and create variantOrders", async () => {
      const variantMap = new Map([
        ["SKU-001", { id: "variant-1", sku: "SKU-001" }],
        ["SKU-002", { id: "variant-2", sku: "SKU-002" }],
      ]);

      vi.mocked(mockRepository.findVariantsBySkus).mockResolvedValue(variantMap);
      vi.mocked(mockRepository.createVariantOrder).mockResolvedValue({} as never);

      const result = await service.createVariantOrdersForOrder(
        "order-123",
        [
          { lineItemId: "line-1", sku: "SKU-001", quantity: 2 },
          { lineItemId: "line-2", sku: "SKU-002", quantity: 1 },
        ],
        "CA",
      );

      expect(result).toHaveLength(2);
      expect(mockRepository.findVariantsBySkus).toHaveBeenCalledWith(["SKU-001", "SKU-002"], "CA");
      expect(mockRepository.createVariantOrder).toHaveBeenCalledTimes(2);
    });

    it("should throw error if variant not found", async () => {
      const variantMap = new Map([["SKU-001", { id: "variant-1", sku: "SKU-001" }]]);

      vi.mocked(mockRepository.findVariantsBySkus).mockResolvedValue(variantMap);

      await expect(
        service.createVariantOrdersForOrder(
          "order-123",
          [
            { lineItemId: "line-1", sku: "SKU-001", quantity: 1 },
            { lineItemId: "line-2", sku: "SKU-999", quantity: 1 }, // Missing variant
          ],
          "CA",
        ),
      ).rejects.toThrow(WmsServiceError);
    });
  });

  describe("createPrepPartsAndItems", () => {
    it("should batch lookup parts and create prepParts", async () => {
      const partMap = new Map([
        ["SKU-001", { id: "part-1", sku: "SKU-001" }],
      ]);

      vi.mocked(mockRepository.findPartsBySkus).mockResolvedValue(partMap);
      vi.mocked(mockRepository.createPrepPart).mockResolvedValue({ id: "prepPart-1" } as never);
      vi.mocked(mockRepository.createPrepPartItem).mockResolvedValue({ id: "prepPartItem-1" } as never);

      const result = await service.createPrepPartsAndItems(
        [{ prepId: "prep-1", variantId: "variant-1", lineItemId: "line-1" }],
        [{ lineItemId: "line-1", sku: "SKU-001", quantity: 2 }],
        "CA",
      );

      expect(result).toHaveLength(1);
      expect(mockRepository.findPartsBySkus).toHaveBeenCalledWith(["SKU-001"], "CA");
    });
  });
});
