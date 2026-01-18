import { describe, expect, it, vi, beforeEach } from "vitest";

import { SeedShopifyOrdersUseCase } from "./SeedShopifyOrdersUseCase";
import { ShopifyService } from "../../services/ShopifyService";
import type { SeedShopifyOrdersRequest } from "../../shared/requests/SeedShopifyOrdersRequest";

describe("SeedShopifyOrdersUseCase", () => {
  let mockShopifyService: ShopifyService;
  let useCase: SeedShopifyOrdersUseCase;

  beforeEach(() => {
    mockShopifyService = {
      createDraftOrder: vi.fn(),
      completeDraftOrder: vi.fn(),
      fulfillOrder: vi.fn(),
      queryOrdersByTag: vi.fn(),
      queryOrderById: vi.fn(),
      findVariantIdsBySkus: vi.fn(),
      formatBatchTag: vi.fn((batchId: string) => `seed_batch_id:${batchId.substring(0, 26)}`),
    } as unknown as ShopifyService;
    useCase = new SeedShopifyOrdersUseCase(mockShopifyService);
  });

  it("should create and complete orders (without fulfillment)", async () => {
    const request: SeedShopifyOrdersRequest = {
      batchId: "batch-123",
      orders: [
        {
          customer: {
            name: "Test Customer",
            email: "test@example.com",
          },
          lineItems: [{ sku: "SKU-001", quantity: 1 }],
        },
      ],
    };

    vi.mocked(mockShopifyService.findVariantIdsBySkus).mockResolvedValue(
      new Map([["SKU-001", "gid://shopify/ProductVariant/1"]]),
    );

    vi.mocked(mockShopifyService.createDraftOrder).mockResolvedValue({
      draftOrderId: "gid://shopify/DraftOrder/123",
    });

    vi.mocked(mockShopifyService.completeDraftOrder).mockResolvedValue({
      orderId: "gid://shopify/Order/456",
      orderNumber: "#1001",
      lineItems: undefined, // Not available in response, will query
    });

    vi.mocked(mockShopifyService.queryOrderById).mockResolvedValue({
      orderId: "gid://shopify/Order/456",
      orderNumber: "#1001",
      lineItems: [
        {
          lineItemId: "gid://shopify/LineItem/1",
          sku: "SKU-001",
          quantity: 1,
        },
      ],
    });

    const result = await useCase.execute(request);

    expect(result.shopifyOrders).toHaveLength(1);
    expect(result.shopifyOrders[0].shopifyOrderId).toBe("gid://shopify/Order/456");
    expect(result.shopifyOrders[0].shopifyOrderNumber).toBe("#1001");
    expect(result.shopifyOrders[0].fulfillmentStatus).toBe("UNFULFILLED");
    expect(result.shopifyOrders[0].lineItems).toHaveLength(1);
    expect(result.shopifyOrders[0].lineItems[0].sku).toBe("SKU-001");
  });

  it("should process multiple orders in parallel", async () => {
    const request: SeedShopifyOrdersRequest = {
      batchId: "batch-123",
      orders: [
        {
          customer: {
            name: "Customer 1",
            email: "customer1@example.com",
          },
          lineItems: [{ sku: "SKU-001", quantity: 1 }],
        },
        {
          customer: {
            name: "Customer 2",
            email: "customer2@example.com",
          },
          lineItems: [{ sku: "SKU-002", quantity: 2 }],
        },
      ],
    };

    vi.mocked(mockShopifyService.findVariantIdsBySkus).mockResolvedValue(
      new Map([
        ["SKU-001", "gid://shopify/ProductVariant/1"],
        ["SKU-002", "gid://shopify/ProductVariant/2"],
      ]),
    );

    vi.mocked(mockShopifyService.createDraftOrder)
      .mockResolvedValueOnce({ draftOrderId: "gid://shopify/DraftOrder/1" })
      .mockResolvedValueOnce({ draftOrderId: "gid://shopify/DraftOrder/2" });

    vi.mocked(mockShopifyService.completeDraftOrder)
      .mockResolvedValueOnce({ orderId: "gid://shopify/Order/1", orderNumber: "#1001", lineItems: undefined })
      .mockResolvedValueOnce({ orderId: "gid://shopify/Order/2", orderNumber: "#1002", lineItems: undefined });

    vi.mocked(mockShopifyService.queryOrderById)
      .mockResolvedValueOnce({
        orderId: "gid://shopify/Order/1",
        orderNumber: "#1001",
        lineItems: [{ lineItemId: "line-1", sku: "SKU-001", quantity: 1 }],
      })
      .mockResolvedValueOnce({
        orderId: "gid://shopify/Order/2",
        orderNumber: "#1002",
        lineItems: [{ lineItemId: "line-2", sku: "SKU-002", quantity: 2 }],
      });

    const result = await useCase.execute(request);

    expect(result.shopifyOrders).toHaveLength(2);
    expect(mockShopifyService.createDraftOrder).toHaveBeenCalledTimes(2);
    expect(mockShopifyService.completeDraftOrder).toHaveBeenCalledTimes(2);
    expect(mockShopifyService.fulfillOrder).not.toHaveBeenCalled();
  });

  it("should construct line items from input if order query returns empty (dry-run scenario)", async () => {
    const request: SeedShopifyOrdersRequest = {
      batchId: "batch-123",
      orders: [
        {
          customer: {
            name: "Test Customer",
            email: "test@example.com",
          },
          lineItems: [{ sku: "SKU-001", quantity: 1 }],
        },
      ],
    };

    vi.mocked(mockShopifyService.findVariantIdsBySkus).mockResolvedValue(
      new Map([["SKU-001", "gid://shopify/ProductVariant/1"]]),
    );

    vi.mocked(mockShopifyService.createDraftOrder).mockResolvedValue({
      draftOrderId: "gid://shopify/DraftOrder/123",
    });

    vi.mocked(mockShopifyService.completeDraftOrder).mockResolvedValue({
      orderId: "gid://shopify/Order/456",
      orderNumber: "#1001",
      lineItems: undefined, // Not available in response, will query
    });

    vi.mocked(mockShopifyService.queryOrderById).mockResolvedValue(null); // Null (e.g., dry-run mode)

    const result = await useCase.execute(request);

    // Should construct line items from input when query returns empty
    expect(result.shopifyOrders).toHaveLength(1);
    expect(result.shopifyOrders[0].shopifyOrderId).toBe("gid://shopify/Order/456");
    expect(result.shopifyOrders[0].lineItems).toHaveLength(1);
    expect(result.shopifyOrders[0].lineItems[0].sku).toBe("SKU-001");
    // Line item ID should be a mock ID (gid://shopify/LineItem/...)
    expect(result.shopifyOrders[0].lineItems[0].lineItemId).toMatch(/^gid:\/\/shopify\/LineItem\//);
  });

  it("should continue processing other orders when one fails (continue-on-error)", async () => {
    const request: SeedShopifyOrdersRequest = {
      batchId: "batch-123",
      orders: [
        {
          customer: {
            name: "Customer 1",
            email: "customer1@example.com",
          },
          lineItems: [{ sku: "SKU-001", quantity: 1 }],
        },
        {
          customer: {
            name: "Customer 2",
            email: "customer2@example.com",
          },
          lineItems: [{ sku: "SKU-002", quantity: 1 }],
        },
        {
          customer: {
            name: "Customer 3",
            email: "customer3@example.com",
          },
          lineItems: [{ sku: "SKU-003", quantity: 1 }],
        },
      ],
    };

    vi.mocked(mockShopifyService.findVariantIdsBySkus).mockResolvedValue(
      new Map([
        ["SKU-001", "gid://shopify/ProductVariant/1"],
        ["SKU-002", "gid://shopify/ProductVariant/2"],
        ["SKU-003", "gid://shopify/ProductVariant/3"],
      ]),
    );

    // First order succeeds
    vi.mocked(mockShopifyService.createDraftOrder).mockResolvedValueOnce({
      draftOrderId: "gid://shopify/DraftOrder/1",
    });
    vi.mocked(mockShopifyService.completeDraftOrder).mockResolvedValueOnce({
      orderId: "gid://shopify/Order/1",
      orderNumber: "#1001",
      lineItems: undefined,
    });
    vi.mocked(mockShopifyService.queryOrderById).mockResolvedValueOnce({
      orderId: "gid://shopify/Order/1",
      orderNumber: "#1001",
      lineItems: [{ lineItemId: "line-1", sku: "SKU-001", quantity: 1 }],
    });

    // Second order fails
    vi.mocked(mockShopifyService.createDraftOrder).mockRejectedValueOnce(
      new Error("Variant not found for SKU: SKU-002"),
    );

    // Third order succeeds
    vi.mocked(mockShopifyService.createDraftOrder).mockResolvedValueOnce({
      draftOrderId: "gid://shopify/DraftOrder/3",
    });
    vi.mocked(mockShopifyService.completeDraftOrder).mockResolvedValueOnce({
      orderId: "gid://shopify/Order/3",
      orderNumber: "#1003",
      lineItems: undefined,
    });
    vi.mocked(mockShopifyService.queryOrderById).mockResolvedValueOnce({
      orderId: "gid://shopify/Order/3",
      orderNumber: "#1003",
      lineItems: [{ lineItemId: "line-3", sku: "SKU-003", quantity: 1 }],
    });

    const result = await useCase.execute(request);

    // Should have 2 successful orders (first and third)
    expect(result.shopifyOrders).toHaveLength(2);
    expect(result.shopifyOrders[0].shopifyOrderId).toBe("gid://shopify/Order/1");
    expect(result.shopifyOrders[1].shopifyOrderId).toBe("gid://shopify/Order/3");
    expect(mockShopifyService.createDraftOrder).toHaveBeenCalledTimes(3);
  });

  it("should throw error if variant lookup fails for some SKUs", async () => {
    const request: SeedShopifyOrdersRequest = {
      batchId: "batch-123",
      orders: [
        {
          customer: {
            name: "Customer 1",
            email: "customer1@example.com",
          },
          lineItems: [{ sku: "SKU-001", quantity: 1 }],
        },
        {
          customer: {
            name: "Customer 2",
            email: "customer2@example.com",
          },
          lineItems: [{ sku: "SKU-002", quantity: 1 }],
        },
      ],
    };

    // Mock variant lookup to return incomplete map (missing SKU-002)
    vi.mocked(mockShopifyService.findVariantIdsBySkus).mockResolvedValue(
      new Map([["SKU-001", "gid://shopify/ProductVariant/1"]]), // Missing SKU-002
    );

    await expect(useCase.execute(request)).rejects.toThrow("Variant lookup failed for 1 SKU(s): SKU-002");
  });

  it("should throw error if orders array is empty", async () => {
    const request: SeedShopifyOrdersRequest = {
      batchId: "batch-123",
      orders: [],
    };

    await expect(useCase.execute(request)).rejects.toThrow("Cannot seed orders: orders array is empty");
  });

  it("should throw error if all orders fail", async () => {
    const request: SeedShopifyOrdersRequest = {
      batchId: "batch-123",
      orders: [
        {
          customer: {
            name: "Customer 1",
            email: "customer1@example.com",
          },
          lineItems: [{ sku: "SKU-001", quantity: 1 }],
        },
      ],
    };

    vi.mocked(mockShopifyService.findVariantIdsBySkus).mockResolvedValue(
      new Map([["SKU-001", "gid://shopify/ProductVariant/1"]]),
    );

    vi.mocked(mockShopifyService.createDraftOrder).mockRejectedValueOnce(
      new Error("Variant not found for SKU: SKU-001"),
    );

    await expect(useCase.execute(request)).rejects.toThrow("All 1 orders failed");
  });
});
