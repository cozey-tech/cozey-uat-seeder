import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

import { WmsPrismaRepository } from "./WmsPrismaRepository";
import type { CreateOrderRequest, CreateCollectionPrepRequest } from "../interface/WmsRepository";
import { WmsRepositoryError, WmsRepositoryErrorType } from "../errors/WmsRepositoryError";

describe("WmsPrismaRepository", () => {
  let mockPrisma: PrismaClient;
  let repository: WmsPrismaRepository;

  beforeEach(() => {
    mockPrisma = {
      order: {
        create: vi.fn(),
        findUnique: vi.fn(),
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
        findMany: vi.fn(),
      },
      variant: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
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

    it("should wrap non-Prisma errors as UNKNOWN_DATABASE_ERROR", async () => {
      const request: CreateOrderRequest = {
        shopifyOrderId: "gid://shopify/Order/123",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      };

      const prismaError = new Error("Database connection failed");
      vi.mocked(mockPrisma.order.create).mockRejectedValue(prismaError);

      await expect(repository.createOrder(request)).rejects.toThrow(WmsRepositoryError);
      await expect(repository.createOrder(request)).rejects.toThrow(
        "Database error for Order with shopifyOrderId gid://shopify/Order/123",
      );
      await expect(repository.createOrder(request)).rejects.toMatchObject({
        type: WmsRepositoryErrorType.UNKNOWN_DATABASE_ERROR,
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

  describe("createPnpPackageInfo", () => {
    it("should create PnP package info", async () => {
      const packageInfo = {
        identifier: "pkg-123",
        length: 10,
        width: 8,
        height: 6,
        weight: 5,
        lengthUnit: "IN" as const,
        widthUnit: "IN" as const,
        heightUnit: "IN" as const,
        weightUnit: "LB" as const,
      };

      vi.mocked(mockPrisma.pnpPackageInfo.create).mockResolvedValue({ id: "pkg-123" } as never);

      await repository.createPnpPackageInfo(packageInfo);

      expect(mockPrisma.pnpPackageInfo.create).toHaveBeenCalledWith({
        data: packageInfo,
      });
    });
  });

  describe("createPnpBox", () => {
    it("should create PnP box", async () => {
      const box = {
        identifier: "box-123",
        length: 10,
        width: 8,
        height: 6,
        region: "CA" as const,
        lengthUnit: "IN" as const,
        widthUnit: "IN" as const,
        heightUnit: "IN" as const,
      };

      vi.mocked(mockPrisma.pnpBox.create).mockResolvedValue({ id: "box-123" } as never);

      await repository.createPnpBox(box);

      expect(mockPrisma.pnpBox.create).toHaveBeenCalledWith({
        data: box,
      });
    });
  });

  describe("createPrepPart", () => {
    it("should create prep part", async () => {
      const prepPart = {
        prepId: "prep-123",
        partId: "part-456",
        quantity: 2,
        region: "CA",
      };

      vi.mocked(mockPrisma.prepPart.create).mockResolvedValue({ id: "prepPart-123" } as never);

      await repository.createPrepPart(prepPart);

      expect(mockPrisma.prepPart.create).toHaveBeenCalledWith({
        data: prepPart,
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

  describe("findVariantBySku", () => {
    it("should find variant by SKU and region", async () => {
      const mockVariant = { id: "variant-123", sku: "VARIANT-SKU-001" };
      vi.mocked(mockPrisma.variant.findFirst).mockResolvedValue(mockVariant as never);

      const result = await repository.findVariantBySku("VARIANT-SKU-001", "CA");

      expect(result).toEqual(mockVariant);
      expect(mockPrisma.variant.findFirst).toHaveBeenCalledWith({
        where: {
          sku: "VARIANT-SKU-001",
          region: "CA",
        },
        select: {
          id: true,
          sku: true,
        },
      });
    });

    it("should return null if variant not found", async () => {
      vi.mocked(mockPrisma.variant.findFirst).mockResolvedValue(null);

      const result = await repository.findVariantBySku("SKU-999", "CA");

      expect(result).toBeNull();
    });
  });

  describe("findVariantsBySkus", () => {
    it("should find multiple variants by SKUs and region", async () => {
      const mockVariants = [
        { id: "variant-1", sku: "SKU-001" },
        { id: "variant-2", sku: "SKU-002" },
      ];
      vi.mocked(mockPrisma.variant.findMany).mockResolvedValue(mockVariants as never);

      const result = await repository.findVariantsBySkus(["SKU-001", "SKU-002"], "CA");

      expect(result.size).toBe(2);
      expect(result.get("SKU-001")).toEqual({ id: "variant-1", sku: "SKU-001" });
      expect(result.get("SKU-002")).toEqual({ id: "variant-2", sku: "SKU-002" });
    });

    it("should return empty map if no variants found", async () => {
      vi.mocked(mockPrisma.variant.findMany).mockResolvedValue([]);

      const result = await repository.findVariantsBySkus(["SKU-999"], "CA");

      expect(result.size).toBe(0);
    });
  });

  describe("findPartsBySkus", () => {
    it("should find multiple parts by SKUs and region", async () => {
      const mockParts = [
        { id: "part-1", sku: "PART-SKU-001" },
        { id: "part-2", sku: "PART-SKU-002" },
      ];
      vi.mocked(mockPrisma.part.findMany).mockResolvedValue(mockParts as never);

      const result = await repository.findPartsBySkus(["PART-SKU-001", "PART-SKU-002"], "CA");

      expect(result.size).toBe(2);
      expect(result.get("PART-SKU-001")).toEqual({ id: "part-1", sku: "PART-SKU-001" });
      expect(result.get("PART-SKU-002")).toEqual({ id: "part-2", sku: "PART-SKU-002" });
    });

    it("should return empty map if no parts found", async () => {
      vi.mocked(mockPrisma.part.findMany).mockResolvedValue([]);

      const result = await repository.findPartsBySkus(["SKU-999"], "CA");

      expect(result.size).toBe(0);
    });
  });

  describe("findOrderByShopifyId", () => {
    it("should find order by Shopify ID", async () => {
      const mockOrder = {
        id: "order-123",
        shopifyOrderId: "gid://shopify/Order/456",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      };
      vi.mocked(mockPrisma.order.findUnique).mockResolvedValue(mockOrder as never);

      const result = await repository.findOrderByShopifyId("gid://shopify/Order/456");

      expect(result).toEqual(mockOrder);
      expect(mockPrisma.order.findUnique).toHaveBeenCalledWith({
        where: {
          shopifyOrderId: "gid://shopify/Order/456",
        },
        select: {
          id: true,
          shopifyOrderId: true,
          shopifyOrderNumber: true,
          status: true,
          region: true,
        },
      });
    });

    it("should return null if order not found", async () => {
      vi.mocked(mockPrisma.order.findUnique).mockResolvedValue(null);

      const result = await repository.findOrderByShopifyId("gid://shopify/Order/999");

      expect(result).toBeNull();
    });
  });

  describe("findCustomerById", () => {
    it("should find customer by ID", async () => {
      const mockCustomer = { id: "customer-123", name: "Test Customer", email: "test@example.com" };
      vi.mocked(mockPrisma.customer.findUnique).mockResolvedValue(mockCustomer as never);

      const result = await repository.findCustomerById("customer-123");

      expect(result).toEqual(mockCustomer);
      expect(mockPrisma.customer.findUnique).toHaveBeenCalledWith({
        where: {
          id: "customer-123",
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });
    });

    it("should return null if customer not found", async () => {
      vi.mocked(mockPrisma.customer.findUnique).mockResolvedValue(null);

      const result = await repository.findCustomerById("customer-999");

      expect(result).toBeNull();
    });

    it("should handle customer with no email", async () => {
      const mockCustomer = { id: "customer-123", name: "Test Customer", email: null };
      vi.mocked(mockPrisma.customer.findUnique).mockResolvedValue(mockCustomer as never);

      const result = await repository.findCustomerById("customer-123");

      expect(result).toEqual({ id: "customer-123", name: "Test Customer", email: undefined });
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

      const promise = repository.createVariantOrder({
        orderId: "order-123",
        lineItemId: "line-1",
        variantId: "variant-1",
        quantity: 1,
        region: "CA",
      });

      await expect(promise).rejects.toThrow(WmsRepositoryError);
      await expect(promise).rejects.toThrow("VariantOrder with lineItemId line-1 already exists");
      await expect(promise).rejects.toMatchObject({
        type: WmsRepositoryErrorType.DUPLICATE_RECORD,
        constraintFields: ["lineItemId"],
      });
    });

    it("should handle Prisma P2002 error for createPrep", async () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["prep", "region"],
        },
      };

      vi.mocked(mockPrisma.prep.create).mockRejectedValue(prismaError);

      const promise = repository.createPrep({
        orderId: "order-123",
        prep: "prep-1",
        collectionPrepId: "cp-1",
        region: "CA",
        variantId: "variant-1",
        lineItemId: "line-1",
      });

      await expect(promise).rejects.toThrow(WmsRepositoryError);
      await expect(promise).rejects.toThrow("Prep with id prep-1 and region CA already exists");
      await expect(promise).rejects.toMatchObject({
        type: WmsRepositoryErrorType.DUPLICATE_RECORD,
      });
    });

    it("should handle Prisma P2002 error for createShipment", async () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["orderId", "collectionPrepId"],
        },
      };

      vi.mocked(mockPrisma.shipment.create).mockRejectedValue(prismaError);

      const promise = repository.createShipment({
        collectionPrepId: "cp-1",
        orderId: "order-123",
        region: "CA",
        status: "ACTIVE",
      });

      await expect(promise).rejects.toThrow(WmsRepositoryError);
      await expect(promise).rejects.toThrow("Shipment for order order-123 and collectionPrep cp-1 already exists");
      await expect(promise).rejects.toMatchObject({
        type: WmsRepositoryErrorType.DUPLICATE_RECORD,
      });
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
