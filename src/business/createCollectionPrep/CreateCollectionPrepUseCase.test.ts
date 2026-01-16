import { describe, expect, it, vi, beforeEach } from "vitest";

import { CreateCollectionPrepUseCase } from "./CreateCollectionPrepUseCase";
import { CollectionPrepService } from "../../services/CollectionPrepService";
import type { CreateCollectionPrepRequest } from "../../shared/requests/CreateCollectionPrepRequest";
import type { PrismaClient } from "@prisma/client";

describe("CreateCollectionPrepUseCase", () => {
  let mockCollectionPrepService: CollectionPrepService;
  let mockPrisma: PrismaClient;
  let useCase: CreateCollectionPrepUseCase;

  beforeEach(() => {
    mockCollectionPrepService = {
      createCollectionPrep: vi.fn(),
      validateOrderMix: vi.fn(),
    } as unknown as CollectionPrepService;

    mockPrisma = {
      carriers: {
        findUnique: vi.fn(),
      },
      location: {
        findUnique: vi.fn(),
      },
    } as unknown as PrismaClient;

    useCase = new CreateCollectionPrepUseCase(mockCollectionPrepService, mockPrisma);
  });

  it("should create collection prep and return ID and region", async () => {
    const request: CreateCollectionPrepRequest = {
      orderIds: ["order-1", "order-2", "order-3"],
      carrier: "UPS",
      locationId: "langley",
      region: "CA",
      prepDate: "2026-01-15T10:00:00Z",
      testTag: "Outbound_Compliance",
    };

    // Mock Prisma queries
    vi.mocked(mockPrisma.carriers.findUnique).mockResolvedValue({
      id: "UPS",
      name: "UPS",
      region: "CA",
      postalCodes: [],
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    vi.mocked(mockPrisma.location.findUnique).mockResolvedValue({
      id: "langley",
      name: "Langley",
      region: "CA",
      provinces: ["BC"],
      allowDynamicEstimates: false,
      allowPrepCreation: false,
      priorityLocations: [],
    });

    const mockCollectionPrep = {
      id: "Outbound_Compliance-Ups-Langley-1234",
      region: "CA",
      carrier: "UPS",
      locationId: "langley",
      prepDate: new Date("2026-01-15"),
      boxes: 3,
    };

    vi.mocked(mockCollectionPrepService.createCollectionPrep).mockResolvedValue(mockCollectionPrep);

    const result = await useCase.execute(request);

    expect(result.collectionPrepId).toMatch(/^Outbound_Compliance-Ups-Langley-[0-9A-F]{4}$/);
    expect(result.region).toBe("CA");
    expect(mockCollectionPrepService.createCollectionPrep).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "CA",
        carrier: "UPS",
        locationId: "langley",
        boxes: 3,
      }),
    );
  });

  it("should set boxes count to number of order IDs", async () => {
    const request: CreateCollectionPrepRequest = {
      orderIds: ["order-1", "order-2", "order-3", "order-4", "order-5"],
      carrier: "CANPAR",
      locationId: "langley",
      region: "CA",
      prepDate: "2026-01-15T10:00:00Z",
      testTag: "Test",
    };

    // Mock Prisma queries
    vi.mocked(mockPrisma.carriers.findUnique).mockResolvedValue({
      id: "CANPAR",
      name: "Canpar",
      region: "CA",
      postalCodes: [],
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    vi.mocked(mockPrisma.location.findUnique).mockResolvedValue({
      id: "langley",
      name: "Langley",
      region: "CA",
      provinces: ["BC"],
      allowDynamicEstimates: false,
      allowPrepCreation: false,
      priorityLocations: [],
    });

    const mockCollectionPrep = {
      id: "Test-Canpar-Langley-ABCD",
      region: "CA",
      carrier: "CANPAR",
      locationId: "langley",
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
