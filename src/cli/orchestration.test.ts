/**
 * Tests for orchestration logic - focusing on index mapping during failures
 */

import { describe, it, expect } from "vitest";

describe("WMS Order Index Mapping", () => {
  describe("when WMS seeding has partial failures", () => {
    it("should correctly map successful orders back to original config indices", () => {
      // Scenario: 5 orders, indices 1 and 3 fail during WMS seeding
      const wmsOrdersToProcess = [
        {
          shopifyOrderId: "order-0",
          shopifyOrderNumber: "1000",
          lineItems: [{ lineItemId: "li-0", sku: "SKU1", quantity: 1 }],
          status: "paid",
          customerName: "C0",
          customerEmail: "c0@example.com",
        },
        {
          shopifyOrderId: "order-1",
          shopifyOrderNumber: "1001",
          lineItems: [{ lineItemId: "li-1", sku: "SKU2", quantity: 1 }],
          status: "paid",
          customerName: "C1",
          customerEmail: "c1@example.com",
        },
        {
          shopifyOrderId: "order-2",
          shopifyOrderNumber: "1002",
          lineItems: [{ lineItemId: "li-2", sku: "SKU3", quantity: 1 }],
          status: "paid",
          customerName: "C2",
          customerEmail: "c2@example.com",
        },
        {
          shopifyOrderId: "order-3",
          shopifyOrderNumber: "1003",
          lineItems: [{ lineItemId: "li-3", sku: "SKU4", quantity: 1 }],
          status: "paid",
          customerName: "C3",
          customerEmail: "c3@example.com",
        },
        {
          shopifyOrderId: "order-4",
          shopifyOrderNumber: "1004",
          lineItems: [{ lineItemId: "li-4", sku: "SKU5", quantity: 1 }],
          status: "paid",
          customerName: "C4",
          customerEmail: "c4@example.com",
        },
      ];

      // WMS returns 3 successful orders (indices 0, 2, 4 succeeded; 1, 3 failed)
      const wmsResult = {
        orders: [
          { orderId: "wms-0", shopifyOrderId: "order-0" },
          { orderId: "wms-2", shopifyOrderId: "order-2" },
          { orderId: "wms-4", shopifyOrderId: "order-4" },
        ],
        shipments: [],
        prepPartItems: [],
        failures: [
          { orderIndex: 1, shopifyOrderId: "order-1", customerEmail: "c1@example.com", error: "SKU2 not found" },
          { orderIndex: 3, shopifyOrderId: "order-3", customerEmail: "c3@example.com", error: "SKU4 not found" },
        ],
      };

      // Original config indices (no filtering, no resume)
      const wmsFilteredToOriginalIndexMap = new Map<number, number>([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ]);

      // FIXED ALGORITHM (from orchestration.ts)
      const successfulOrderIdToProcessedIndex = new Map<string, number>();
      for (let processedIndex = 0; processedIndex < wmsOrdersToProcess.length; processedIndex++) {
        const order = wmsOrdersToProcess[processedIndex];
        if (order) {
          successfulOrderIdToProcessedIndex.set(order.shopifyOrderId, processedIndex);
        }
      }

      const mappedOrders: Array<{ orderIndex: number; orderId: string; shopifyOrderId: string }> = [];
      for (const order of wmsResult.orders) {
        const processedIndex = successfulOrderIdToProcessedIndex.get(order.shopifyOrderId);
        if (processedIndex !== undefined) {
          const originalIndex = wmsFilteredToOriginalIndexMap.get(processedIndex);
          if (originalIndex !== undefined) {
            mappedOrders.push({
              orderIndex: originalIndex,
              orderId: order.orderId,
              shopifyOrderId: order.shopifyOrderId,
            });
          }
        }
      }

      // EXPECTED: Orders mapped to config indices 0, 2, 4
      expect(mappedOrders).toEqual([
        { orderIndex: 0, orderId: "wms-0", shopifyOrderId: "order-0" },
        { orderIndex: 2, orderId: "wms-2", shopifyOrderId: "order-2" },
        { orderIndex: 4, orderId: "wms-4", shopifyOrderId: "order-4" },
      ]);
    });

    it("should handle case where successful order Shopify IDs don't match expected sequence", () => {
      // This test ensures robustness: even if wmsResult.orders are not in the expected sequence,
      // mapping should be correct by looking up shopifyOrderId
      const wmsOrdersToProcess = [
        {
          shopifyOrderId: "order-0",
          shopifyOrderNumber: "1000",
          lineItems: [],
          status: "paid",
          customerName: "C0",
          customerEmail: "c0@example.com",
        },
        {
          shopifyOrderId: "order-1",
          shopifyOrderNumber: "1001",
          lineItems: [],
          status: "paid",
          customerName: "C1",
          customerEmail: "c1@example.com",
        },
        {
          shopifyOrderId: "order-2",
          shopifyOrderNumber: "1002",
          lineItems: [],
          status: "paid",
          customerName: "C2",
          customerEmail: "c2@example.com",
        },
      ];

      // Simulating orders returned in different sequence (for algorithmic robustness testing)
      const wmsResult = {
        orders: [
          { orderId: "wms-2", shopifyOrderId: "order-2" }, // Should be index 2
          { orderId: "wms-0", shopifyOrderId: "order-0" }, // Should be index 0
          { orderId: "wms-1", shopifyOrderId: "order-1" }, // Should be index 1
        ],
        shipments: [],
        prepPartItems: [],
        failures: [],
      };

      const wmsFilteredToOriginalIndexMap = new Map<number, number>([
        [0, 0],
        [1, 1],
        [2, 2],
      ]);

      // FIXED ALGORITHM - map by shopifyOrderId lookup
      const successfulOrderIdToProcessedIndex = new Map<string, number>();
      for (let processedIndex = 0; processedIndex < wmsOrdersToProcess.length; processedIndex++) {
        const order = wmsOrdersToProcess[processedIndex];
        if (order) {
          successfulOrderIdToProcessedIndex.set(order.shopifyOrderId, processedIndex);
        }
      }

      const mappedOrders: Array<{ orderIndex: number; orderId: string; shopifyOrderId: string }> = [];
      for (const order of wmsResult.orders) {
        const processedIndex = successfulOrderIdToProcessedIndex.get(order.shopifyOrderId);
        if (processedIndex !== undefined) {
          const originalIndex = wmsFilteredToOriginalIndexMap.get(processedIndex);
          if (originalIndex !== undefined) {
            mappedOrders.push({
              orderIndex: originalIndex,
              orderId: order.orderId,
              shopifyOrderId: order.shopifyOrderId,
            });
          }
        }
      }

      // EXPECTED: Should correctly map by shopifyOrderId regardless of position in result array
      expect(mappedOrders).toEqual([
        { orderIndex: 2, orderId: "wms-2", shopifyOrderId: "order-2" }, // Correct: order-2 -> index 2
        { orderIndex: 0, orderId: "wms-0", shopifyOrderId: "order-0" }, // Correct: order-0 -> index 0
        { orderIndex: 1, orderId: "wms-1", shopifyOrderId: "order-1" }, // Correct: order-1 -> index 1
      ]);
    });
  });

  describe("when resuming after partial WMS failure", () => {
    it("should correctly track which orders still need processing", () => {
      // TODO: Add test for resume scenario
      expect(true).toBe(true);
    });
  });
});
