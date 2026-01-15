import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

import { WmsPrismaRepository } from "./WmsPrismaRepository";
import type {
  CreateOrderRequest,
  CreateCollectionPrepRequest,
} from "../interface/WmsRepository";

describe("WmsPrismaRepository", () => {
  let mockPrisma: PrismaClient;
  let repository: WmsPrismaRepository;

  beforeEach(() => {
    mockPrisma = {
      order: {
        create: vi.fn(),
      },
      variantOrder: {
        create: vi.fn(),
      },
      prep: {
        create: vi.fn(),
      },
      collectionPrep: {
        create: vi.fn(),
      },
      shipment: {
        create: vi.fn(),
      },
      pnpPackageInfo: {
        create: vi.fn(),
      },
      pnpBox: {
        create: vi.fn(),
      },
      pnpOrderBox: {
        create: vi.fn(),
      },
      prepPart: {
        create: vi.fn(),
      },
      prepPartItem: {
        create: vi.fn(),
      },
      part: {
        findFirst: vi.fn(),
      },
      variant: {
        findFirst: vi.fn(),
      },
      customer: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    } as unknown as PrismaClient;
    repository = new WmsPrismaRepository(mockPrisma);
  });

  describe("createOrder", () => {
    it("should create order with sourceName", async () => {
      const request: CreateOrderRequest = {
        shopifyOrderId: "gid://shopify/Order/123",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
        sourceName: "wms_seed",
      };

      const mockOrder = {
        id: "order-123",
        shopifyOrderId: "gid://shopify/Order/123",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      };

      vi.mocked(mockPrisma.order.create).mockResolvedValue(mockOrder as never);

      const result = await repository.createOrder(request);

      expect(result.shopifyOrderId).toBe("gid://shopify/Order/123");
      expect(result.shopifyOrderNumber).toBe("#1001");
      expect(mockPrisma.order.create).toHaveBeenCalledWith({
        data: {
          shopifyOrderId: request.shopifyOrderId,
          shopifyOrderNumber: request.shopifyOrderNumber,
          status: request.status,
          region: request.region,
          customerId: undefined,
          locationId: undefined,
          sourceName: "wms_seed",
        },
      });
    });
  });

  describe("createCollectionPrep", () => {
    it("should create collection prep", async () => {
      const request: CreateCollectionPrepRequest = {
        id: "cp-123",
        region: "CA",
        carrier: "UPS",
        locationId: "loc-123",
        prepDate: new Date("2026-01-15"),
        boxes: 5,
      };

      const mockCollectionPrep = {
        id: "cp-123",
        region: "CA",
        carrier: "UPS",
        locationId: "loc-123",
        prepDate: new Date("2026-01-15"),
        boxes: 5,
      };

      vi.mocked(mockPrisma.collectionPrep.create).mockResolvedValue(mockCollectionPrep as never);

      const result = await repository.createCollectionPrep(request);

      expect(result.id).toBe("cp-123");
      expect(result.region).toBe("CA");
      expect(mockPrisma.collectionPrep.create).toHaveBeenCalledWith({
        data: {
          id: request.id,
          region: request.region,
          carrier: request.carrier,
          locationId: request.locationId,
          prepDate: request.prepDate,
          boxes: request.boxes,
        },
      });
    });
  });

  describe("findPartBySku", () => {
    it("should find part by SKU and region", async () => {
      const mockPart = {
        id: "part-123",
        sku: "SKU-001",
      };

      vi.mocked(mockPrisma.part.findFirst).mockResolvedValue(mockPart as never);

      const result = await repository.findPartBySku("SKU-001", "CA");

      expect(result).toEqual(mockPart);
      expect(mockPrisma.part.findFirst).toHaveBeenCalledWith({
        where: {
          sku: "SKU-001",
          region: "CA",
        },
        select: {
          id: true,
          sku: true,
        },
      });
    });

    it("should return null if part not found", async () => {
      vi.mocked(mockPrisma.part.findFirst).mockResolvedValue(null);

      const result = await repository.findPartBySku("SKU-999", "CA");

      expect(result).toBeNull();
    });
  });
});
