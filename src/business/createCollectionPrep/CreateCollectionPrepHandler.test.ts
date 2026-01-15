import { describe, expect, it, vi, beforeEach } from "vitest";

import { CreateCollectionPrepHandler } from "./CreateCollectionPrepHandler";
import { CreateCollectionPrepUseCase } from "./CreateCollectionPrepUseCase";
import { InputValidationError } from "../../services/InputParserService";
import type { CreateCollectionPrepRequest } from "../../shared/requests/CreateCollectionPrepRequest";

describe("CreateCollectionPrepHandler", () => {
  let mockUseCase: CreateCollectionPrepUseCase;
  let handler: CreateCollectionPrepHandler;

  beforeEach(() => {
    mockUseCase = {
      execute: vi.fn(),
    } as unknown as CreateCollectionPrepUseCase;
    handler = new CreateCollectionPrepHandler(mockUseCase);
  });

  it("should validate request and call use case", async () => {
    const request: CreateCollectionPrepRequest = {
      orderIds: ["order-1", "order-2"],
      carrier: "UPS",
      locationId: "loc-123",
      region: "CA",
      prepDate: "2026-01-15T10:00:00Z",
    };

    const expectedResponse = {
      collectionPrepId: "cp-123",
      region: "CA",
    };

    vi.mocked(mockUseCase.execute).mockResolvedValue(expectedResponse);

    const result = await handler.execute(request);

    expect(result).toEqual(expectedResponse);
    expect(mockUseCase.execute).toHaveBeenCalledWith(request);
  });

  it("should throw InputValidationError for invalid request", async () => {
    const invalidRequest = {
      // Missing required fields
      carrier: "UPS",
    };

    await expect(handler.execute(invalidRequest)).rejects.toThrow(InputValidationError);
    await expect(handler.execute(invalidRequest)).rejects.toThrow("validation failed");
  });

  it("should throw InputValidationError for invalid datetime format", async () => {
    const invalidRequest = {
      orderIds: ["order-1"],
      carrier: "UPS",
      locationId: "loc-123",
      region: "CA",
      prepDate: "invalid-date",
    };

    await expect(handler.execute(invalidRequest)).rejects.toThrow(InputValidationError);
  });

  it("should throw InputValidationError for empty orderIds array", async () => {
    const invalidRequest = {
      orderIds: [],
      carrier: "UPS",
      locationId: "loc-123",
      region: "CA",
      prepDate: "2026-01-15T10:00:00Z",
    };

    await expect(handler.execute(invalidRequest)).rejects.toThrow(InputValidationError);
  });
});
