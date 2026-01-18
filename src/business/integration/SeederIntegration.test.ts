import { describe, expect, it, vi, beforeEach } from "vitest";

import { SeedShopifyOrdersUseCase } from "../seedShopifyOrders/SeedShopifyOrdersUseCase";
import { SeedWmsEntitiesUseCase } from "../seedWmsEntities/SeedWmsEntitiesUseCase";
import { CreateCollectionPrepUseCase } from "../createCollectionPrep/CreateCollectionPrepUseCase";
import { ShopifyService } from "../../services/ShopifyService";
import { WmsService } from "../../services/WmsService";
import { CollectionPrepService } from "../../services/CollectionPrepService";
import type { WmsRepository } from "../../repositories/interface/WmsRepository";
import type { PrismaClient } from "@prisma/client";

/**
 * Integration tests for the full seeding flow
 * These tests verify that components work together correctly
 */
describe("Seeder Integration", () => {
  let mockShopifyService: ShopifyService;
  let mockWmsRepository: WmsRepository;
  let mockWmsService: WmsService;
  let mockCollectionPrepService: CollectionPrepService;
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    // Setup mocks for all services
    mockShopifyService = {
      createDraftOrder: vi.fn(),
      completeDraftOrder: vi.fn(),
      fulfillOrder: vi.fn(),
      queryOrdersByTag: vi.fn(),
      queryOrderById: vi.fn(),
      findVariantIdsBySkus: vi.fn(),
      formatBatchTag: vi.fn((batchId: string) => `seed_batch_id:${batchId.substring(0, 26)}`),
    } as unknown as ShopifyService;

    mockWmsRepository = {
      findOrderByShopifyId: vi.fn(),
      findCustomerByEmail: vi.fn(),
      createOrderWithCustomerTransaction: vi.fn(),
      findVariantsBySkus: vi.fn(),
      findPartsBySkus: vi.fn(),
      findPartsByVariantIds: vi.fn(),
      createVariantOrder: vi.fn(),
      createPrep: vi.fn(),
      createPrepPart: vi.fn(),
      createPrepPartItem: vi.fn(),
      createShipment: vi.fn(),
      createCollectionPrep: vi.fn(),
    } as unknown as WmsRepository;

    mockPrisma = {
      location: {
        findUnique: vi.fn(),
      },
    } as unknown as PrismaClient;

    mockWmsService = new WmsService(mockWmsRepository);
    mockCollectionPrepService = new CollectionPrepService(mockWmsRepository);
  });

  describe("End-to-end seeding flow", () => {
    it("should create Shopify orders, then WMS entities, then collection prep", async () => {
      // Step 1: Create Shopify orders
      const shopifyUseCase = new SeedShopifyOrdersUseCase(mockShopifyService);

      // Mock variant lookup to return a Map
      vi.mocked(mockShopifyService.findVariantIdsBySkus).mockResolvedValue(
        new Map([["SKU-001", "gid://shopify/ProductVariant/1"]]),
      );

      vi.mocked(mockShopifyService.createDraftOrder).mockResolvedValue({
        draftOrderId: "gid://shopify/DraftOrder/123",
      });
      vi.mocked(mockShopifyService.completeDraftOrder).mockResolvedValue({
        orderId: "gid://shopify/Order/456",
        orderNumber: "#1001",
        lineItems: undefined, // Not available in response, will query
      });
      vi.mocked(mockShopifyService.fulfillOrder).mockResolvedValue({
        fulfillmentId: "fulfillment-1",
        status: "SUCCESS",
      });
      vi.mocked(mockShopifyService.queryOrderById).mockResolvedValue({
        orderId: "gid://shopify/Order/456",
        orderNumber: "#1001",
        lineItems: [{ lineItemId: "line-1", sku: "SKU-001", quantity: 2 }],
      });

      const shopifyRequest = {
        batchId: "batch-123",
        orders: [
          {
            customer: { name: "Test Customer", email: "test@example.com" },
            lineItems: [{ sku: "SKU-001", quantity: 2 }],
          },
        ],
      };

      const shopifyResponse = await shopifyUseCase.execute(shopifyRequest);
      expect(shopifyResponse.shopifyOrders).toHaveLength(1);

      // Step 2: Create WMS entities
      const wmsUseCase = new SeedWmsEntitiesUseCase(mockWmsService);

      vi.mocked(mockWmsRepository.findOrderByShopifyId).mockResolvedValue(null);
      vi.mocked(mockWmsRepository.findCustomerByEmail).mockResolvedValue(null);
      vi.mocked(mockWmsRepository.createOrderWithCustomerTransaction).mockResolvedValue({
        order: {
          id: "order-123",
          shopifyOrderId: "gid://shopify/Order/456",
          shopifyOrderNumber: "#1001",
          status: "fulfilled",
          region: "CA",
        },
        customerId: "customer-123",
      });
      vi.mocked(mockWmsRepository.findVariantsBySkus).mockResolvedValue(
        new Map([["SKU-001", { id: "variant-1", sku: "SKU-001" }]]),
      );
      vi.mocked(mockWmsRepository.findPartsByVariantIds).mockResolvedValue(
        new Map([["variant-1", [{ id: "part-1", sku: "PART-SKU-001", quantity: 1 }]]]),
      );
      vi.mocked(mockWmsRepository.createVariantOrder).mockResolvedValue({} as never);
      vi.mocked(mockWmsRepository.createPrep).mockResolvedValue({} as never);
      vi.mocked(mockWmsRepository.createPrepPart).mockResolvedValue({ id: "prepPart-1" } as never);
      vi.mocked(mockWmsRepository.createPrepPartItem).mockResolvedValue({ id: "prepPartItem-1" } as never);

      const wmsRequest = {
        shopifyOrders: shopifyResponse.shopifyOrders.map((order) => ({
          shopifyOrderId: order.shopifyOrderId,
          shopifyOrderNumber: order.shopifyOrderNumber,
          status: "fulfilled",
          customerName: "Test Customer",
          customerEmail: "test@example.com",
          lineItems: order.lineItems.map((item) => ({
            lineItemId: item.lineItemId,
            sku: item.sku,
            quantity: 2,
          })),
        })),
        region: "CA",
      };

      const wmsResponse = await wmsUseCase.execute(wmsRequest);
      expect(wmsResponse.orders).toHaveLength(1);

      // Step 3: Create collection prep
      // Mock Prisma queries for location (carrier lookup now uses enum, no need to mock)
      vi.mocked(mockPrisma.location.findUnique).mockResolvedValue({
        id: "loc-123",
        name: "Test Location",
        region: "CA",
        provinces: [],
        allowDynamicEstimates: false,
        allowPrepCreation: false,
        priorityLocations: [],
      });

      const collectionPrepUseCase = new CreateCollectionPrepUseCase(mockCollectionPrepService, mockPrisma);

      vi.mocked(mockWmsRepository.createCollectionPrep).mockResolvedValue({
        id: "Test-Fedex-TestLocation-1234",
        region: "CA",
        carrier: "Fedex",
        locationId: "loc-123",
        prepDate: new Date("2026-01-15"),
        boxes: 1,
      });

      const collectionPrepResponse = await collectionPrepUseCase.execute({
        orderIds: [wmsResponse.orders[0].shopifyOrderId],
        carrier: "Fedex",
        locationId: "loc-123",
        region: "CA",
        prepDate: "2026-01-15T10:00:00Z",
        testTag: "Test",
      });

      expect(collectionPrepResponse.collectionPrepId).toMatch(/^Test-Fedex-TestLocation-[0-9A-F]{4}$/);
    });

    it("should handle idempotency - skip existing orders", async () => {
      const wmsUseCase = new SeedWmsEntitiesUseCase(mockWmsService);

      const existingOrder = {
        id: "order-123",
        shopifyOrderId: "gid://shopify/Order/456",
        shopifyOrderNumber: "#1001",
        status: "fulfilled",
        region: "CA",
      };

      vi.mocked(mockWmsRepository.findOrderByShopifyId).mockResolvedValue(existingOrder);

      const wmsRequest = {
        shopifyOrders: [
          {
            shopifyOrderId: "gid://shopify/Order/456",
            shopifyOrderNumber: "#1001",
            lineItems: [{ lineItemId: "line-1", sku: "SKU-001" }],
          },
        ],
        region: "CA",
      };

      const wmsResponse = await wmsUseCase.execute(wmsRequest);

      expect(wmsResponse.orders).toHaveLength(1);
      expect(wmsResponse.orders[0].orderId).toBe("order-123");
      expect(mockWmsRepository.createOrderWithCustomerTransaction).not.toHaveBeenCalled();
    });
  });
});
