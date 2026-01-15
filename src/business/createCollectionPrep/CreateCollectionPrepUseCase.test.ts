import { describe, expect, it, vi, beforeEach } from "vitest";

import { CreateCollectionPrepUseCase } from "./CreateCollectionPrepUseCase";
import { CollectionPrepService } from "../../services/CollectionPrepService";
import type { CreateCollectionPrepRequest } from "../../shared/requests/CreateCollectionPrepRequest";

describe("CreateCollectionPrepUseCase", () => {
  let mockCollectionPrepService: CollectionPrepService;
  let useCase: CreateCollectionPrepUseCase;

  beforeEach(() => {
    mockCollectionPrepService = {
      createCollectionPrep: vi.fn(),
      validateOrderMix: vi.fn(),
    } as unknown as CollectionPrepService;
    useCase = new CreateCollectionPrepUseCase(mockCollectionPrepService);
  });

  it("should create collection prep and return ID and region", async () => {
    const request: CreateCollectionPrepRequest = {
      orderIds: ["order-1", "order-2", "order-3"],
      carrier: "UPS",
      locationId: "loc-123",
      region: "CA",
      prepDate: "2026-01-15T10:00:00Z",
    };

    const mockCollectionPrep = {
      id: "cp-123",
      region: "CA",
      carrier: "UPS",
      locationId: "loc-123",
      prepDate: new Date("2026-01-15"),
      boxes: 3,
    };

    vi.mocked(mockCollectionPrepService.createCollectionPrep).mockResolvedValue(mockCollectionPrep);

    const result = await useCase.execute(request);

    expect(result.collectionPrepId).toBe("cp-123");
    expect(result.region).toBe("CA");
    expect(mockCollectionPrepService.createCollectionPrep).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "CA",
        carrier: "UPS",
        locationId: "loc-123",
        boxes: 3,
      }),
    );
  });

  it("should set boxes count to number of order IDs", async () => {
    const request: CreateCollectionPrepRequest = {
      orderIds: ["order-1", "order-2", "order-3", "order-4", "order-5"],
      carrier: "UPS",
      locationId: "loc-123",
      region: "CA",
      prepDate: "2026-01-15T10:00:00Z",
    };

    const mockCollectionPrep = {
      id: "cp-123",
      region: "CA",
      carrier: "UPS",
      locationId: "loc-123",
      prepDate: new Date("2026-01-15"),
      boxes: 5,
    };

    vi.mocked(mockCollectionPrepService.createCollectionPrep).mockResolvedValue(mockCollectionPrep);

    await useCase.execute(request);

    expect(mockCollectionPrepService.createCollectionPrep).toHaveBeenCalledWith(
      expect.objectContaining({
        boxes: 5,
      }),
    );
  });
});
