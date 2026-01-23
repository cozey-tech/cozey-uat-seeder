import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrderPollerService, WebhookTimeoutError } from "./OrderPollerService";
import type { WmsRepository } from "../repositories/interface/WmsRepository";

describe("OrderPollerService", () => {
  let mockRepository: WmsRepository;
  let service: OrderPollerService;

  beforeEach(() => {
    mockRepository = {
      findOrderByShopifyId: vi.fn(),
      findPrepsByOrderIds: vi.fn(),
      // Add other methods as no-ops
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
      findPartsByVariantIds: vi.fn(),
      findVariantBySku: vi.fn(),
      findVariantsBySkus: vi.fn(),
      findCustomerById: vi.fn(),
      findCustomerByEmail: vi.fn(),
      findOrdersByShopifyIds: vi.fn(),
      findOrdersBySourceName: vi.fn(),
      findOrdersByIds: vi.fn(),
      findShipmentsByOrderIds: vi.fn(),
      findCollectionPrepById: vi.fn(),
      findCollectionPrepByName: vi.fn(),
      findCollectionPrepsByIds: vi.fn(),
      findShipmentsByCollectionPrepId: vi.fn(),
      previewBatchDeletion: vi.fn(),
      deleteOrderEntitiesTransaction: vi.fn(),
      deleteCollectionPrep: vi.fn(),
      createCustomer: vi.fn(),
      createOrderWithCustomerTransaction: vi.fn(),
      createOrderEntitiesTransaction: vi.fn(),
    } as unknown as WmsRepository;

    service = new OrderPollerService(mockRepository);
  });

  describe("pollForOrders", () => {
    it("should return immediately when all orders found on first poll", async () => {
      const order1 = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "ACTIVE",
        customerId: "customer-1",
        region: "CA",
      };

      const preps1 = [
        { prep: "prep-1", orderId: "shopify-order-1", lineItemId: "line-1", region: "CA", collectionPrepId: null },
      ];

      vi.mocked(mockRepository.findOrderByShopifyId).mockResolvedValue(order1);
      vi.mocked(mockRepository.findPrepsByOrderIds).mockResolvedValue(preps1);

      const result = await service.pollForOrders(["shopify-order-1"], {
        timeout: 10000,
        pollInterval: 1000,
      });

      expect(result.foundOrders).toHaveLength(1);
      expect(result.foundOrders[0]).toEqual({
        shopifyOrderId: "shopify-order-1",
        wmsOrderId: "wms-order-1",
        preps: [{ prepId: "prep-1", lineItemId: "line-1" }],
      });
      expect(result.missingOrders).toEqual([]);
      expect(result.partialSuccess).toBe(false);
    });

    it("should poll multiple times until order appears", async () => {
      const order = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "ACTIVE",
        customerId: "customer-1",
        region: "CA",
      };

      const preps = [
        { prep: "prep-1", orderId: "shopify-order-1", lineItemId: "line-1", region: "CA", collectionPrepId: null },
      ];

      // First 2 calls return null, 3rd call returns order
      vi.mocked(mockRepository.findOrderByShopifyId)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(order);

      vi.mocked(mockRepository.findPrepsByOrderIds).mockResolvedValue(preps);

      const result = await service.pollForOrders(["shopify-order-1"], {
        timeout: 10000,
        pollInterval: 100, // Short interval for testing
      });

      expect(mockRepository.findOrderByShopifyId).toHaveBeenCalledTimes(3);
      expect(result.foundOrders).toHaveLength(1);
    });

    it("should call onProgress callback with elapsed time", async () => {
      const order = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "ACTIVE",
        customerId: "customer-1",
        region: "CA",
      };

      const preps = [
        { prep: "prep-1", orderId: "shopify-order-1", lineItemId: "line-1", region: "CA", collectionPrepId: null },
      ];

      vi.mocked(mockRepository.findOrderByShopifyId).mockResolvedValue(order);
      vi.mocked(mockRepository.findPrepsByOrderIds).mockResolvedValue(preps);

      const onProgress = vi.fn();

      await service.pollForOrders(["shopify-order-1"], {
        timeout: 10000,
        pollInterval: 100,
        onProgress,
      });

      expect(onProgress).toHaveBeenCalled();
      const call = onProgress.mock.calls[0];
      expect(call[0]).toBe(1); // found count
      expect(call[1]).toBe(1); // total count
      expect(call[2]).toBeGreaterThanOrEqual(0); // elapsed time
    });

    it("should handle multiple orders with different ingestion times", async () => {
      const order1 = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "ACTIVE",
        customerId: "customer-1",
        region: "CA",
      };

      const order2 = {
        id: "wms-order-2",
        shopifyOrderId: "shopify-order-2",
        shopifyOrderNumber: "#12346",
        status: "ACTIVE",
        customerId: "customer-2",
        region: "CA",
      };

      const preps1 = [
        { prep: "prep-1", orderId: "shopify-order-1", lineItemId: "line-1", region: "CA", collectionPrepId: null },
      ];
      const preps2 = [
        { prep: "prep-2", orderId: "shopify-order-2", lineItemId: "line-2", region: "CA", collectionPrepId: null },
      ];

      // Order 1 appears immediately, Order 2 appears after 2 polls
      vi.mocked(mockRepository.findOrderByShopifyId).mockImplementation(async (id) => {
        if (id === "shopify-order-1") return order1;
        // Order 2 not ready yet on first few calls
        if (vi.mocked(mockRepository.findOrderByShopifyId).mock.calls.length <= 3) {
          return null;
        }
        return order2;
      });

      vi.mocked(mockRepository.findPrepsByOrderIds).mockImplementation(async (orderIds) => {
        if (orderIds.includes("shopify-order-1")) return preps1;
        if (orderIds.includes("shopify-order-2")) return preps2;
        return [];
      });

      const result = await service.pollForOrders(["shopify-order-1", "shopify-order-2"], {
        timeout: 10000,
        pollInterval: 100,
      });

      expect(result.foundOrders).toHaveLength(2);
      expect(result.missingOrders).toEqual([]);
      expect(result.partialSuccess).toBe(false);
    });

    it("should throw WebhookTimeoutError when no orders found within timeout", async () => {
      // Always return null (order never appears)
      vi.mocked(mockRepository.findOrderByShopifyId).mockResolvedValue(null);

      await expect(
        service.pollForOrders(["shopify-order-1"], {
          timeout: 500, // Short timeout for testing
          pollInterval: 100,
        }),
      ).rejects.toThrow(WebhookTimeoutError);

      await expect(
        service.pollForOrders(["shopify-order-1"], {
          timeout: 500,
          pollInterval: 100,
        }),
      ).rejects.toThrow(/No orders found in WMS/);
    });

    it("should throw WebhookTimeoutError with missing IDs on partial timeout (strict mode)", async () => {
      const order1 = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "ACTIVE",
        customerId: "customer-1",
        region: "CA",
      };

      const preps1 = [
        { prep: "prep-1", orderId: "shopify-order-1", lineItemId: "line-1", region: "CA", collectionPrepId: null },
      ];

      // Order 1 found, Order 2 never appears
      vi.mocked(mockRepository.findOrderByShopifyId).mockImplementation(async (id) => {
        if (id === "shopify-order-1") return order1;
        return null;
      });

      vi.mocked(mockRepository.findPrepsByOrderIds).mockResolvedValue(preps1);

      await expect(
        service.pollForOrders(["shopify-order-1", "shopify-order-2"], {
          timeout: 500,
          pollInterval: 100,
          allowPartialSuccess: false, // Strict mode
        }),
      ).rejects.toThrow(WebhookTimeoutError);

      // Verify error contains missing order IDs
      let caughtError: WebhookTimeoutError | null = null;
      try {
        await service.pollForOrders(["shopify-order-1", "shopify-order-2"], {
          timeout: 500,
          pollInterval: 100,
          allowPartialSuccess: false,
        });
      } catch (error) {
        caughtError = error as WebhookTimeoutError;
      }

      expect(caughtError).toBeInstanceOf(WebhookTimeoutError);
      expect(caughtError?.missingOrderIds).toEqual(["shopify-order-2"]);
    });

    it("should succeed with partial results when allowPartialSuccess enabled", async () => {
      const order1 = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "ACTIVE",
        customerId: "customer-1",
        region: "CA",
      };

      const preps1 = [
        { prep: "prep-1", orderId: "shopify-order-1", lineItemId: "line-1", region: "CA", collectionPrepId: null },
      ];

      // Order 1 found, Order 2 never appears
      vi.mocked(mockRepository.findOrderByShopifyId).mockImplementation(async (id) => {
        if (id === "shopify-order-1") return order1;
        return null;
      });

      vi.mocked(mockRepository.findPrepsByOrderIds).mockResolvedValue(preps1);

      const result = await service.pollForOrders(["shopify-order-1", "shopify-order-2"], {
        timeout: 500,
        pollInterval: 100,
        allowPartialSuccess: true,
      });

      expect(result.foundOrders).toHaveLength(1);
      expect(result.missingOrders).toEqual(["shopify-order-2"]);
      expect(result.partialSuccess).toBe(true);
    });

    it("should skip orders that are incomplete (missing status or customerId)", async () => {
      const incompleteOrder = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "",
        customerId: null,
        region: "CA",
      };

      const completeOrder = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "ACTIVE",
        customerId: "customer-1",
        region: "CA",
      };

      const preps = [
        { prep: "prep-1", orderId: "shopify-order-1", lineItemId: "line-1", region: "CA", collectionPrepId: null },
      ];

      // First call returns incomplete order (no preps), second call returns complete order (with preps)
      vi.mocked(mockRepository.findOrderByShopifyId)
        .mockResolvedValueOnce(incompleteOrder)
        .mockResolvedValue(completeOrder);

      // First call: no preps (incomplete order), second call: preps exist (complete order)
      vi.mocked(mockRepository.findPrepsByOrderIds)
        .mockResolvedValueOnce([]) // No preps for incomplete order
        .mockResolvedValue(preps); // Preps exist for complete order

      const result = await service.pollForOrders(["shopify-order-1"], {
        timeout: 10000,
        pollInterval: 100,
      });

      // Should have polled at least twice (once for incomplete, once for complete)
      expect(mockRepository.findOrderByShopifyId).toHaveBeenCalledTimes(2);
      expect(result.foundOrders).toHaveLength(1);
    });

    it("should return preps created by COS webhook for each order", async () => {
      const order1 = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "ACTIVE",
        customerId: "customer-1",
        region: "CA",
      };

      const order2 = {
        id: "wms-order-2",
        shopifyOrderId: "shopify-order-2",
        shopifyOrderNumber: "#12346",
        status: "ACTIVE",
        customerId: "customer-2",
        region: "CA",
      };

      const preps1 = [
        { prep: "prep-1a", orderId: "shopify-order-1", lineItemId: "line-1a", region: "CA", collectionPrepId: null },
        { prep: "prep-1b", orderId: "shopify-order-1", lineItemId: "line-1b", region: "CA", collectionPrepId: null },
      ];

      const preps2 = [
        { prep: "prep-2", orderId: "shopify-order-2", lineItemId: "line-2", region: "CA", collectionPrepId: null },
      ];

      vi.mocked(mockRepository.findOrderByShopifyId).mockImplementation(async (id) => {
        if (id === "shopify-order-1") return order1;
        if (id === "shopify-order-2") return order2;
        return null;
      });

      vi.mocked(mockRepository.findPrepsByOrderIds).mockImplementation(async (orderIds) => {
        if (orderIds.includes("shopify-order-1")) return preps1;
        if (orderIds.includes("shopify-order-2")) return preps2;
        return [];
      });

      const result = await service.pollForOrders(["shopify-order-1", "shopify-order-2"], {
        timeout: 10000,
        pollInterval: 100,
      });

      expect(result.foundOrders).toHaveLength(2);
      expect(result.foundOrders[0].preps).toHaveLength(2);
      expect(result.foundOrders[1].preps).toHaveLength(1);
      expect(result.foundOrders[0].preps).toEqual([
        { prepId: "prep-1a", lineItemId: "line-1a" },
        { prepId: "prep-1b", lineItemId: "line-1b" },
      ]);
    });

    it("should handle empty preps array when COS hasn't created preps yet", async () => {
      const order = {
        id: "wms-order-1",
        shopifyOrderId: "shopify-order-1",
        shopifyOrderNumber: "#12345",
        status: "ACTIVE",
        customerId: "customer-1",
        region: "CA",
      };

      // Order exists but no preps yet (COS may create order before preps)
      // Service requires preps.length > 0 to consider order ingested, so this will timeout
      vi.mocked(mockRepository.findOrderByShopifyId).mockResolvedValue(order);
      vi.mocked(mockRepository.findPrepsByOrderIds).mockResolvedValue([]);

      // Service will continue polling until timeout since preps.length === 0
      // This test verifies timeout behavior when preps never appear
      await expect(
        service.pollForOrders(["shopify-order-1"], {
          timeout: 500, // Short timeout for test
          pollInterval: 50,
        }),
      ).rejects.toThrow(WebhookTimeoutError);
    });
  });

  describe("WebhookTimeoutError", () => {
    it("should include missing order IDs in error", () => {
      const error = new WebhookTimeoutError("Timeout message", ["order-1", "order-2"]);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("WebhookTimeoutError");
      expect(error.message).toBe("Timeout message");
      expect(error.missingOrderIds).toEqual(["order-1", "order-2"]);
    });
  });
});
