import { describe, expect, it, vi, beforeEach } from "vitest";
import { CleanupHandler } from "./CleanupHandler";
import type { CleanupUseCase } from "./CleanupUseCase";
import type { CleanupResponse } from "../../shared/responses/CleanupResponse";
import { InputValidationError } from "../../services/InputParserService";

describe("CleanupHandler", () => {
  let mockUseCase: CleanupUseCase;
  let handler: CleanupHandler;

  beforeEach(() => {
    mockUseCase = {
      execute: vi.fn(),
    } as unknown as CleanupUseCase;

    handler = new CleanupHandler(mockUseCase);
  });

  describe("execute", () => {
    it("should validate request and delegate to use case", async () => {
      const request = {
        batchId: "550e8400-e29b-41d4-a716-446655440000",
        dryRun: false,
        skipConfirmation: false,
      };

      const expectedResponse: CleanupResponse = {
        shopifyOrders: {
          deleted: ["order-1"],
          archived: [],
          failed: [],
        },
        wmsEntities: {
          orders: { deleted: 1, failed: 0 },
          preps: { deleted: 1, failed: 0 },
          shipments: { deleted: 1, failed: 0 },
          collectionPreps: { deleted: 1, failed: 0 },
        },
        summary: {
          totalDeleted: 2,
          totalArchived: 0,
          totalFailed: 0,
          durationMs: 1000,
        },
      };

      vi.mocked(mockUseCase.execute).mockResolvedValue(expectedResponse);

      const result = await handler.execute(request);

      expect(result).toEqual(expectedResponse);
      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: request.batchId,
          dryRun: false,
          skipConfirmation: false,
        }),
      );
    });

    it("should throw InputValidationError if no identifier provided", async () => {
      const request = {
        dryRun: false,
        skipConfirmation: false,
      };

      await expect(handler.execute(request)).rejects.toThrow(InputValidationError);
      await expect(handler.execute(request)).rejects.toThrow("Must provide one of");
    });

    it("should throw InputValidationError if batchId is not a UUID", async () => {
      const request = {
        batchId: "not-a-uuid",
        dryRun: false,
      };

      await expect(handler.execute(request)).rejects.toThrow(InputValidationError);
    });

    it("should accept collectionPrepName as identifier", async () => {
      const request = {
        collectionPrepName: "Test-Canpar-Langley-1234",
        dryRun: false,
        skipConfirmation: false,
      };

      const expectedResponse: CleanupResponse = {
        shopifyOrders: { deleted: [], archived: [], failed: [] },
        wmsEntities: {
          orders: { deleted: 0, failed: 0 },
          preps: { deleted: 0, failed: 0 },
          shipments: { deleted: 0, failed: 0 },
          collectionPreps: { deleted: 0, failed: 0 },
        },
        summary: { totalDeleted: 0, totalArchived: 0, totalFailed: 0, durationMs: 100 },
      };

      vi.mocked(mockUseCase.execute).mockResolvedValue(expectedResponse);

      await handler.execute(request);

      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionPrepName: "Test-Canpar-Langley-1234",
        }),
      );
    });

    it("should accept custom tag as identifier", async () => {
      const request = {
        tag: "wms_seed",
        dryRun: true,
      };

      const expectedResponse: CleanupResponse = {
        shopifyOrders: { deleted: [], archived: [], failed: [] },
        wmsEntities: {
          orders: { deleted: 0, failed: 0 },
          preps: { deleted: 0, failed: 0 },
          shipments: { deleted: 0, failed: 0 },
          collectionPreps: { deleted: 0, failed: 0 },
        },
        summary: { totalDeleted: 0, totalArchived: 0, totalFailed: 0, durationMs: 50 },
      };

      vi.mocked(mockUseCase.execute).mockResolvedValue(expectedResponse);

      await handler.execute(request);

      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          tag: "wms_seed",
          dryRun: true,
        }),
      );
    });
  });
});
