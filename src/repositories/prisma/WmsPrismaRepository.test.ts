import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

import { WmsPrismaRepository } from "./WmsPrismaRepository";
import type { CreateOrderRequest, CreateCollectionPrepRequest } from "../interface/WmsRepository";

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
      $transaction: vi.fn(),
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

    it("should throw error with context message on Prisma P2002 unique constraint violation", async () => {
      const request: CreateOrderRequest = {
        shopifyOrderId: "gid://shopify/Order/123",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      };

      const prismaError = {
        code: "P2002",
        meta: {
          target: ["shopifyOrderId"],
        },
      };

      vi.mocked(mockPrisma.order.create).mockRejectedValue(prismaError);

      await expect(repository.createOrder(request)).rejects.toThrow(
        "Order with shopifyOrderId gid://shopify/Order/123 already exists",
      );
    });

    it("should re-throw non-P2002 errors", async () => {
      const request: CreateOrderRequest = {
        shopifyOrderId: "gid://shopify/Order/123",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      };

      const prismaError = new Error("Database connection failed");
      vi.mocked(mockPrisma.order.create).mockRejectedValue(prismaError);

      await expect(repository.createOrder(request)).rejects.toThrow("Database connection failed");
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

  describe("error handling", () => {
    it("should handle Prisma P2002 error for createVariantOrder", async () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["lineItemId"],
        },
      };

      vi.mocked(mockPrisma.variantOrder.create).mockRejectedValue(prismaError);

      await expect(
        repository.createVariantOrder({
          orderId: "order-123",
          lineItemId: "line-1",
          variantId: "variant-1",
          quantity: 1,
          region: "CA",
        }),
      ).rejects.toThrow("VariantOrder with lineItemId line-1 already exists");
    });

    it("should handle Prisma P2002 error for createPrep", async () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["prep", "region"],
        },
      };

      vi.mocked(mockPrisma.prep.create).mockRejectedValue(prismaError);

      await expect(
        repository.createPrep({
          orderId: "order-123",
          prep: "prep-1",
          collectionPrepId: "cp-1",
          region: "CA",
          variantId: "variant-1",
          lineItemId: "line-1",
        }),
      ).rejects.toThrow("Prep with id prep-1 and region CA already exists");
    });

    it("should handle Prisma P2002 error for createShipment", async () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["orderId", "collectionPrepId"],
        },
      };

      vi.mocked(mockPrisma.shipment.create).mockRejectedValue(prismaError);

      await expect(
        repository.createShipment({
          collectionPrepId: "cp-1",
          orderId: "order-123",
          region: "CA",
          status: "ACTIVE",
        }),
      ).rejects.toThrow("Shipment for order order-123 and collectionPrep cp-1 already exists");
    });

    it("should handle Prisma P2002 error for createCustomer", async () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["id", "email"],
        },
      };

      vi.mocked(mockPrisma.customer.create).mockRejectedValue(prismaError);

      await expect(
        repository.createCustomer({
          id: "customer-123",
          name: "Test Customer",
          email: "test@example.com",
          region: "CA",
        }),
      ).rejects.toThrow("Customer with id customer-123 or email test@example.com already exists");
    });
  });

  describe("createOrderEntitiesTransaction", () => {
    it("should create order, variantOrders, and preps in transaction", async () => {
      const orderRequest: CreateOrderRequest = {
        shopifyOrderId: "gid://shopify/Order/123",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      };

      const mockTx = {
        order: {
          create: vi.fn().mockResolvedValue({
            id: "order-123",
            shopifyOrderId: "gid://shopify/Order/123",
            shopifyOrderNumber: "#1001",
            status: "fulfilled",
            region: "CA",
          }),
        },
        variantOrder: {
          create: vi.fn().mockResolvedValue({ lineItemId: "line-1" }),
        },
        prep: {
          create: vi.fn().mockResolvedValue({ prep: "prep-1" }),
        },
      };

      vi.mocked(mockPrisma.$transaction).mockImplementation(async (callback) => {
        return await callback(mockTx as never);
      });

      const result = await repository.createOrderEntitiesTransaction(
        orderRequest,
        [
          {
            orderId: "order-123",
            lineItemId: "line-1",
            variantId: "variant-1",
            quantity: 1,
            region: "CA",
          },
        ],
        [
          {
            orderId: "order-123",
            prep: "prep-1",
            collectionPrepId: "cp-1",
            region: "CA",
            variantId: "variant-1",
            lineItemId: "line-1",
          },
        ],
      );

      expect(result.order.id).toBe("order-123");
      expect(result.variantOrderIds).toEqual(["line-1"]);
      expect(result.prepIds).toEqual(["prep-1"]);
    });

    it("should rollback transaction on error", async () => {
      const orderRequest: CreateOrderRequest = {
        shopifyOrderId: "gid://shopify/Order/123",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      };

      const mockTx = {
        order: {
          create: vi.fn().mockResolvedValue({
            id: "order-123",
            shopifyOrderId: "gid://shopify/Order/123",
            shopifyOrderNumber: "#1001",
            status: "fulfilled",
            region: "CA",
          }),
        },
        variantOrder: {
          create: vi.fn().mockRejectedValue(new Error("Database error")),
        },
        prep: {
          create: vi.fn(),
        },
      };

      vi.mocked(mockPrisma.$transaction).mockImplementation(async (callback) => {
        return await callback(mockTx as never);
      });

      await expect(
        repository.createOrderEntitiesTransaction(
          orderRequest,
          [
            {
              orderId: "order-123",
              lineItemId: "line-1",
              variantId: "variant-1",
              quantity: 1,
              region: "CA",
            },
          ],
          [],
        ),
      ).rejects.toThrow("Database error");

      // Verify prep.create was never called (transaction rolled back)
      expect(mockTx.prep.create).not.toHaveBeenCalled();
    });
  });
});
