import { describe, expect, it, vi, beforeEach } from "vitest";

import { SeedShopifyOrdersHandler } from "./SeedShopifyOrdersHandler";
import { SeedShopifyOrdersUseCase } from "./SeedShopifyOrdersUseCase";
import { InputValidationError } from "../../services/InputParserService";
import type { SeedShopifyOrdersRequest } from "../../shared/requests/SeedShopifyOrdersRequest";

describe("SeedShopifyOrdersHandler", () => {
  let mockUseCase: SeedShopifyOrdersUseCase;
  let handler: SeedShopifyOrdersHandler;

  beforeEach(() => {
    mockUseCase = {
      execute: vi.fn(),
    } as unknown as SeedShopifyOrdersUseCase;
    handler = new SeedShopifyOrdersHandler(mockUseCase);
  });

  it("should validate request and call use case", async () => {
    const request: SeedShopifyOrdersRequest = {
      batchId: "550e8400-e29b-41d4-a716-446655440000",
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

    const expectedResponse = {
      shopifyOrders: [
        {
          shopifyOrderId: "gid://shopify/Order/456",
          shopifyOrderNumber: "#1001",
          lineItems: [{ lineItemId: "line-1", sku: "SKU-001" }],
          fulfillmentStatus: "SUCCESS",
        },
      ],
    };

    vi.mocked(mockUseCase.execute).mockResolvedValue(expectedResponse);

    const result = await handler.execute(request);

    expect(result).toEqual(expectedResponse);
    expect(mockUseCase.execute).toHaveBeenCalledWith(request);
  });

  it("should throw InputValidationError for invalid request", async () => {
    const invalidRequest = {
      // Missing required fields
      orders: [],
    };

    await expect(handler.execute(invalidRequest)).rejects.toThrow(InputValidationError);
    await expect(handler.execute(invalidRequest)).rejects.toThrow("validation failed");
  });

  it("should throw InputValidationError for invalid batch ID format", async () => {
    const invalidRequest = {
      batchId: "not-a-uuid",
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

    await expect(handler.execute(invalidRequest)).rejects.toThrow(InputValidationError);
  });

  it("should throw InputValidationError for invalid email", async () => {
    const invalidRequest = {
      batchId: "550e8400-e29b-41d4-a716-446655440000",
      orders: [
        {
          customer: {
            name: "Test Customer",
            email: "not-an-email",
          },
          lineItems: [{ sku: "SKU-001", quantity: 1 }],
        },
      ],
    };

    await expect(handler.execute(invalidRequest)).rejects.toThrow(InputValidationError);
  });
});
