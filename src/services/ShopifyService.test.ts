import { describe, expect, it, vi, beforeEach } from "vitest";

import { ShopifyService, ShopifyServiceError } from "./ShopifyService";

// Mock the admin API client
vi.mock("@shopify/admin-api-client", () => ({
  createAdminApiClient: vi.fn(() => ({
    request: vi.fn(),
  })),
}));

// Mock env config
vi.mock("../config/env", () => ({
  getEnvConfig: vi.fn(() => ({
    SHOPIFY_STORE_DOMAIN: "test-store.myshopify.com",
    SHOPIFY_ACCESS_TOKEN: "test-token",
    SHOPIFY_API_VERSION: "2024-01",
  })),
}));

describe("ShopifyService", () => {
  let service: ShopifyService;
  let mockClient: { request: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { createAdminApiClient } = await import("@shopify/admin-api-client");
    mockClient = {
      request: vi.fn(),
    };
    vi.mocked(createAdminApiClient).mockReturnValue(mockClient as never);
    vi.clearAllMocks();
    service = new ShopifyService();
  });

  describe("createDraftOrder", () => {
    it("should create draft order with variant IDs", async () => {
      const input = {
        customer: {
          name: "Test Customer",
          email: "test@example.com",
        },
        lineItems: [
          { sku: "SKU-001", quantity: 2 },
          { sku: "SKU-002", quantity: 1 },
        ],
      };

      // Mock variant lookup
      mockClient.request
        .mockResolvedValueOnce({
          data: {
            products: {
              edges: [
                {
                  node: {
                    variants: {
                      edges: [
                        { node: { id: "gid://shopify/ProductVariant/1", sku: "SKU-001" } },
                        { node: { id: "gid://shopify/ProductVariant/2", sku: "SKU-002" } },
                      ],
                    },
                  },
                },
              ],
            },
          },
          errors: undefined,
          extensions: undefined,
        })
        .mockResolvedValueOnce({
          data: {
            draftOrderCreate: {
              draftOrder: {
                id: "gid://shopify/DraftOrder/123",
                name: "DRAFT-123",
              },
              userErrors: [],
            },
          },
          errors: undefined,
          extensions: undefined,
        });

      const result = await service.createDraftOrder(input, "batch-123");

      expect(result.draftOrderId).toBe("gid://shopify/DraftOrder/123");
      expect(mockClient.request).toHaveBeenCalledTimes(2);
    });

    it("should throw error if variant not found", async () => {
      const input = {
        customer: {
          name: "Test Customer",
          email: "test@example.com",
        },
        lineItems: [{ sku: "SKU-001", quantity: 1 }],
      };

      // Mock variant lookup returning products but no matching SKU
      // The service will call findVariantIdsBySkus which returns an empty map
      // Then createDraftOrder will throw when it can't find the variant
      mockClient.request.mockResolvedValue({
        data: {
          products: {
            edges: [
              {
                node: {
                  variants: {
                    edges: [{ node: { id: "gid://shopify/ProductVariant/1", sku: "SKU-OTHER" } }],
                  },
                },
              },
            ],
          },
        },
        errors: undefined,
        extensions: undefined,
      });

      await expect(service.createDraftOrder(input, "batch-123")).rejects.toThrow(
        ShopifyServiceError,
      );
      await expect(service.createDraftOrder(input, "batch-123")).rejects.toThrow("Variant not found for SKU: SKU-001");
    });

    it("should throw error on user errors from API", async () => {
      const input = {
        customer: {
          name: "Test Customer",
          email: "test@example.com",
        },
        lineItems: [{ sku: "SKU-001", quantity: 1 }],
      };

      // First call: variant lookup succeeds
      // Second call: draft order creation fails with user errors
      mockClient.request
        .mockResolvedValueOnce({
          data: {
            products: {
              edges: [
                {
                  node: {
                    variants: {
                      edges: [{ node: { id: "gid://shopify/ProductVariant/1", sku: "SKU-001" } }],
                    },
                  },
                },
              ],
            },
          },
          errors: undefined,
          extensions: undefined,
        })
        .mockResolvedValueOnce({
          data: {
            draftOrderCreate: {
              draftOrder: null,
              userErrors: [{ message: "Invalid email", field: ["email"] }],
            },
          },
          errors: undefined,
          extensions: undefined,
        });

      const error = await service.createDraftOrder(input, "batch-123").catch((e) => e);
      expect(error).toBeInstanceOf(ShopifyServiceError);
      expect(error.message).toContain("Failed to create draft order");
    });
  });

  describe("completeDraftOrder", () => {
    it("should complete draft order and return order details", async () => {
      mockClient.request.mockResolvedValueOnce({
        data: {
          draftOrderComplete: {
            draftOrder: {
              id: "gid://shopify/DraftOrder/123",
              order: {
                id: "gid://shopify/Order/456",
                name: "#1001",
              },
            },
            userErrors: [],
          },
        },
        errors: undefined,
        extensions: undefined,
      });

      const result = await service.completeDraftOrder("gid://shopify/DraftOrder/123");

      expect(result.orderId).toBe("gid://shopify/Order/456");
      expect(result.orderNumber).toBe("#1001");
    });

    it("should throw error on user errors", async () => {
      mockClient.request.mockResolvedValueOnce({
        data: {
          draftOrderComplete: {
            draftOrder: null,
            userErrors: [{ message: "Draft order not found" }],
          },
        },
        errors: undefined,
        extensions: undefined,
      });

      await expect(service.completeDraftOrder("invalid-id")).rejects.toThrow(ShopifyServiceError);
    });
  });

  describe("fulfillOrder", () => {
    it("should fulfill order with all line items", async () => {
      mockClient.request
        .mockResolvedValueOnce({
          data: {
            order: {
              id: "gid://shopify/Order/456",
              lineItems: {
                edges: [
                  { node: { id: "gid://shopify/LineItem/1", quantity: 2 } },
                  { node: { id: "gid://shopify/LineItem/2", quantity: 1 } },
                ],
              },
            },
          },
          errors: undefined,
          extensions: undefined,
        })
        .mockResolvedValueOnce({
          data: {
            fulfillmentCreate: {
              fulfillment: {
                id: "gid://shopify/Fulfillment/789",
                status: "SUCCESS",
              },
              userErrors: [],
            },
          },
          errors: undefined,
          extensions: undefined,
        });

      const result = await service.fulfillOrder("gid://shopify/Order/456");

      expect(result.fulfillmentId).toBe("gid://shopify/Fulfillment/789");
      expect(result.status).toBe("SUCCESS");
    });

    it("should throw error if order not found", async () => {
      mockClient.request.mockResolvedValue({
        data: {
          order: null,
        },
        errors: [{ message: "Order not found" }],
        extensions: undefined,
      });

      const error = await service.fulfillOrder("invalid-id").catch((e) => e);
      expect(error).toBeInstanceOf(ShopifyServiceError);
      expect(error.message).toContain("not found");
    });
  });

  describe("queryOrdersByTag", () => {
    it("should return orders with line items", async () => {
      mockClient.request.mockResolvedValueOnce({
        data: {
          orders: {
            edges: [
              {
                node: {
                  id: "gid://shopify/Order/456",
                  name: "#1001",
                  lineItems: {
                    edges: [
                      { node: { id: "gid://shopify/LineItem/1", sku: "SKU-001", quantity: 2 } },
                      { node: { id: "gid://shopify/LineItem/2", sku: "SKU-002", quantity: 1 } },
                    ],
                  },
                },
              },
            ],
          },
        },
        errors: undefined,
        extensions: undefined,
      });

      const result = await service.queryOrdersByTag("seed_batch_id:batch-123");

      expect(result).toHaveLength(1);
      expect(result[0].orderId).toBe("gid://shopify/Order/456");
      expect(result[0].orderNumber).toBe("#1001");
      expect(result[0].lineItems).toHaveLength(2);
      expect(result[0].lineItems[0].sku).toBe("SKU-001");
    });
  });

  describe("findVariantIdsBySkus", () => {
    it("should return map of SKU to variant ID", async () => {
      mockClient.request.mockResolvedValueOnce({
        data: {
          products: {
            edges: [
              {
                node: {
                  variants: {
                    edges: [
                      { node: { id: "gid://shopify/ProductVariant/1", sku: "SKU-001" } },
                      { node: { id: "gid://shopify/ProductVariant/2", sku: "SKU-002" } },
                    ],
                  },
                },
              },
            ],
          },
        },
        errors: undefined,
        extensions: undefined,
      });

      const result = await service.findVariantIdsBySkus(["SKU-001", "SKU-002"]);

      expect(result.get("SKU-001")).toBe("gid://shopify/ProductVariant/1");
      expect(result.get("SKU-002")).toBe("gid://shopify/ProductVariant/2");
    });
  });
});
