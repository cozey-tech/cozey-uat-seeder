import { describe, expect, it, vi, beforeEach } from "vitest";

import { SeedWmsEntitiesHandler } from "./SeedWmsEntitiesHandler";
import { SeedWmsEntitiesUseCase } from "./SeedWmsEntitiesUseCase";
import { InputValidationError } from "../../services/InputParserService";
import type { SeedWmsEntitiesRequest } from "../../shared/requests/SeedWmsEntitiesRequest";

describe("SeedWmsEntitiesHandler", () => {
  let mockUseCase: SeedWmsEntitiesUseCase;
  let handler: SeedWmsEntitiesHandler;

  beforeEach(() => {
    mockUseCase = {
      execute: vi.fn(),
    } as unknown as SeedWmsEntitiesUseCase;
    handler = new SeedWmsEntitiesHandler(mockUseCase);
  });

  it("should validate request and call use case", async () => {
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

    const expectedResponse = {
      orders: [{ orderId: "order-123", shopifyOrderId: "gid://shopify/Order/123" }],
      shipments: [],
      prepPartItems: [],
    };

    vi.mocked(mockUseCase.execute).mockResolvedValue(expectedResponse);

    const result = await handler.execute(request);

    expect(result).toEqual(expectedResponse);
    expect(mockUseCase.execute).toHaveBeenCalledWith(request);
  });

  it("should throw InputValidationError for invalid request", async () => {
    const invalidRequest = {
      // Missing required fields
      region: "CA",
    };

    await expect(handler.execute(invalidRequest)).rejects.toThrow(InputValidationError);
  });
});
