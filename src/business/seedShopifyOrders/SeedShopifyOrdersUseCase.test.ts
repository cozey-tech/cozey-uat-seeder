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
          lineItems: [
            { sku: "SKU-001", quantity: 1 },
          ],
        },
      ],
    };

    vi.mocked(mockShopifyService.createDraftOrder).mockResolvedValue({
      draftOrderId: "gid://shopify/DraftOrder/123",
    });

    vi.mocked(mockShopifyService.completeDraftOrder).mockResolvedValue({
      orderId: "gid://shopify/Order/456",
      orderNumber: "#1001",
      lineItems: undefined, // Not available in response, will query
    });

    vi.mocked(mockShopifyService.queryOrdersByTag).mockResolvedValue([
      {
        orderId: "gid://shopify/Order/456",
        orderNumber: "#1001",
        lineItems: [
          {
            lineItemId: "gid://shopify/LineItem/1",
            sku: "SKU-001",
            quantity: 1,
          },
        ],
      },
    ]);

    const result = await useCase.execute(request);

    expect(result.shopifyOrders).toHaveLength(1);
    expect(result.shopifyOrders[0].shopifyOrderId).toBe("gid://shopify/Order/456");
    expect(result.shopifyOrders[0].shopifyOrderNumber).toBe("#1001");
    expect(result.shopifyOrders[0].fulfillmentStatus).toBe("UNFULFILLED");
    expect(result.shopifyOrders[0].lineItems).toHaveLength(1);
    expect(result.shopifyOrders[0].lineItems[0].sku).toBe("SKU-001");
  });

  it("should process multiple orders sequentially", async () => {
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

    vi.mocked(mockShopifyService.createDraftOrder)
      .mockResolvedValueOnce({ draftOrderId: "gid://shopify/DraftOrder/1" })
      .mockResolvedValueOnce({ draftOrderId: "gid://shopify/DraftOrder/2" });

    vi.mocked(mockShopifyService.completeDraftOrder)
      .mockResolvedValueOnce({ orderId: "gid://shopify/Order/1", orderNumber: "#1001", lineItems: undefined })
      .mockResolvedValueOnce({ orderId: "gid://shopify/Order/2", orderNumber: "#1002", lineItems: undefined });

    vi.mocked(mockShopifyService.queryOrdersByTag)
      .mockResolvedValueOnce([
        {
          orderId: "gid://shopify/Order/1",
          orderNumber: "#1001",
          lineItems: [{ lineItemId: "line-1", sku: "SKU-001", quantity: 1 }],
        },
      ])
      .mockResolvedValueOnce([
        {
          orderId: "gid://shopify/Order/2",
          orderNumber: "#1002",
          lineItems: [{ lineItemId: "line-2", sku: "SKU-002", quantity: 2 }],
        },
      ]);

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

    vi.mocked(mockShopifyService.createDraftOrder).mockResolvedValue({
      draftOrderId: "gid://shopify/DraftOrder/123",
    });

    vi.mocked(mockShopifyService.completeDraftOrder).mockResolvedValue({
      orderId: "gid://shopify/Order/456",
      orderNumber: "#1001",
      lineItems: undefined, // Not available in response, will query
    });

    vi.mocked(mockShopifyService.queryOrdersByTag).mockResolvedValue([]); // Empty (e.g., dry-run mode)

    const result = await useCase.execute(request);

    // Should construct line items from input when query returns empty
    expect(result.shopifyOrders).toHaveLength(1);
    expect(result.shopifyOrders[0].shopifyOrderId).toBe("gid://shopify/Order/456");
    expect(result.shopifyOrders[0].lineItems).toHaveLength(1);
    expect(result.shopifyOrders[0].lineItems[0].sku).toBe("SKU-001");
    // Line item ID should be a mock ID (gid://shopify/LineItem/...)
    expect(result.shopifyOrders[0].lineItems[0].lineItemId).toMatch(/^gid:\/\/shopify\/LineItem\//);
  });

});
