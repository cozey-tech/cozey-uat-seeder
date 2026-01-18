import { describe, expect, it, vi, beforeEach } from "vitest";

import { SeedWmsEntitiesUseCase } from "./SeedWmsEntitiesUseCase";
import { WmsService } from "../../services/WmsService";
import type { SeedWmsEntitiesRequest } from "../../shared/requests/SeedWmsEntitiesRequest";

describe("SeedWmsEntitiesUseCase", () => {
  let mockWmsService: WmsService;
  let useCase: SeedWmsEntitiesUseCase;

  beforeEach(() => {
    mockWmsService = {
      repository: {
        findOrderByShopifyId: vi.fn(),
        findCustomerByEmail: vi.fn(),
        createOrderWithCustomerTransaction: vi.fn(),
        createOrder: vi.fn(),
        createVariantOrder: vi.fn(),
        createPrep: vi.fn(),
        createPrepPart: vi.fn(),
        createPrepPartItem: vi.fn(),
        createShipment: vi.fn(),
        findVariantsBySkus: vi.fn(),
        findPartsBySkus: vi.fn(),
        findPartsByVariantIds: vi.fn(),
      } as unknown as WmsService["repository"],
      createOrderWithCustomer: vi.fn(),
      createVariantOrdersForOrder: vi.fn(),
      createPrepsForOrder: vi.fn(),
      createPrepPartsAndItems: vi.fn(),
      createShipmentForOrder: vi.fn(),
    } as unknown as WmsService;
    useCase = new SeedWmsEntitiesUseCase(mockWmsService);
  });

  it("should skip existing orders (idempotency)", async () => {
    const request: SeedWmsEntitiesRequest = {
      shopifyOrders: [
        {
          shopifyOrderId: "gid://shopify/Order/123",
          shopifyOrderNumber: "#1001",
          lineItems: [{ lineItemId: "line-1", sku: "SKU-001" }],
        },
      ],
      region: "CA",
    };

    const existingOrder = {
      id: "order-123",
      shopifyOrderId: "gid://shopify/Order/123",
      shopifyOrderNumber: "#1001",
      status: "fulfilled",
      region: "CA",
    };

    vi.mocked(mockWmsService.repository.findOrderByShopifyId).mockResolvedValue(existingOrder);

    const result = await useCase.execute(request);

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].orderId).toBe("order-123");
    expect(mockWmsService.createOrderWithCustomer).not.toHaveBeenCalled();
  });

  it("should create WMS entities for new orders", async () => {
    const request: SeedWmsEntitiesRequest = {
      shopifyOrders: [
        {
          shopifyOrderId: "gid://shopify/Order/123",
          shopifyOrderNumber: "#1001",
          status: "fulfilled",
          customerName: "Test Customer",
          customerEmail: "test@example.com",
          lineItems: [{ lineItemId: "line-1", sku: "SKU-001", quantity: 2 }],
        },
      ],
      region: "CA",
    };

    vi.mocked(mockWmsService.repository.findOrderByShopifyId).mockResolvedValue(null);
    vi.mocked(mockWmsService.createOrderWithCustomer).mockResolvedValue({
      orderDbId: "order-123",
      shopifyOrderId: "gid://shopify/Order/123",
      customerId: "customer-123",
    });
    vi.mocked(mockWmsService.createVariantOrdersForOrder).mockResolvedValue([
      { variantId: "variant-1", lineItemId: "line-1" },
    ]);
    vi.mocked(mockWmsService.createPrepsForOrder).mockResolvedValue([
      { prepId: "prep-1", variantId: "variant-1", lineItemId: "line-1" },
    ]);
    vi.mocked(mockWmsService.createPrepPartsAndItems).mockResolvedValue([
      { prepPartId: "prepPart-1", prepPartItemId: "prepPartItem-1", partId: "part-1" },
    ]);

    const result = await useCase.execute(request);

    expect(result.orders).toHaveLength(1);
    expect(mockWmsService.createOrderWithCustomer).toHaveBeenCalledWith(
      "gid://shopify/Order/123",
      "#1001",
      "fulfilled",
      "CA",
      "Test Customer",
      "test@example.com",
    );
    expect(mockWmsService.createVariantOrdersForOrder).toHaveBeenCalledWith(
      "gid://shopify/Order/123",
      [{ lineItemId: "line-1", sku: "SKU-001", quantity: 2 }],
      "CA",
    );
  });

  it("should use actual quantities from request", async () => {
    const request: SeedWmsEntitiesRequest = {
      shopifyOrders: [
        {
          shopifyOrderId: "gid://shopify/Order/123",
          shopifyOrderNumber: "#1001",
          lineItems: [{ lineItemId: "line-1", sku: "SKU-001", quantity: 5 }],
        },
      ],
      region: "CA",
    };

    vi.mocked(mockWmsService.repository.findOrderByShopifyId).mockResolvedValue(null);
    vi.mocked(mockWmsService.createOrderWithCustomer).mockResolvedValue({
      orderDbId: "order-123",
      shopifyOrderId: "gid://shopify/Order/123",
      customerId: "customer-123",
    });
    vi.mocked(mockWmsService.createVariantOrdersForOrder).mockResolvedValue([
      { variantId: "variant-1", lineItemId: "line-1" },
    ]);
    vi.mocked(mockWmsService.createPrepsForOrder).mockResolvedValue([
      { prepId: "prep-1", variantId: "variant-1", lineItemId: "line-1" },
    ]);
    vi.mocked(mockWmsService.createPrepPartsAndItems).mockResolvedValue([
      { prepPartId: "prepPart-1", prepPartItemId: "prepPartItem-1", partId: "part-1" },
    ]);

    await useCase.execute(request);

    expect(mockWmsService.createVariantOrdersForOrder).toHaveBeenCalledWith(
      expect.any(String),
      [{ lineItemId: "line-1", sku: "SKU-001", quantity: 5 }],
      "CA",
    );
  });
});
