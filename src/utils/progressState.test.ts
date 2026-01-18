import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, unlinkSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  saveProgressState,
  loadProgressState,
  deleteProgressState,
  listProgressStates,
  type ProgressState,
} from "./progressState";

describe("ProgressState", () => {
  const testBatchId = "test-batch-123";
  const testState: ProgressState = {
    batchId: testBatchId,
    timestamp: Date.now(),
    shopifyOrders: {
      successful: [
        {
          orderIndex: 0,
          shopifyOrderId: "order-1",
          shopifyOrderNumber: "#1001",
          customerEmail: "test@example.com",
        },
      ],
      failed: [],
    },
    wmsEntities: {
      successful: [
        {
          orderIndex: 0,
          orderId: "wms-order-1",
          shopifyOrderId: "order-1",
        },
      ],
      failed: [],
    },
  };

  beforeEach(() => {
    // Clean up any existing test files
    const progressDir = join(process.cwd(), ".progress");
    if (existsSync(progressDir)) {
      const files = readdirSync(progressDir);
      for (const file of files) {
        if (file.startsWith("test-")) {
          try {
            unlinkSync(join(progressDir, file));
          } catch {
            // Ignore errors
          }
        }
      }
    }
  });

  afterEach(() => {
    // Clean up test files
    try {
      deleteProgressState(testBatchId);
    } catch {
      // Ignore errors
    }
  });

  describe("saveProgressState", () => {
    it("should save progress state to file", () => {
      saveProgressState(testState);
      expect(loadProgressState(testBatchId)).toEqual(testState);
    });

    it("should create .progress directory if it doesn't exist", () => {
      const progressDir = join(process.cwd(), ".progress");
      // Don't assume directory exists
      saveProgressState(testState);
      expect(existsSync(progressDir)).toBe(true);
      expect(loadProgressState(testBatchId)).toEqual(testState);
    });

    it("should overwrite existing state", () => {
      saveProgressState(testState);
      const updatedState: ProgressState = {
        ...testState,
        shopifyOrders: {
          ...testState.shopifyOrders,
          successful: [
            ...testState.shopifyOrders.successful,
            {
              orderIndex: 1,
              shopifyOrderId: "order-2",
              shopifyOrderNumber: "#1002",
              customerEmail: "test2@example.com",
            },
          ],
        },
      };
      saveProgressState(updatedState);
      expect(loadProgressState(testBatchId)).toEqual(updatedState);
    });
  });

  describe("loadProgressState", () => {
    it("should load existing progress state", () => {
      saveProgressState(testState);
      const loaded = loadProgressState(testBatchId);
      expect(loaded).toEqual(testState);
    });

    it("should return null for non-existent batch", () => {
      expect(loadProgressState("non-existent-batch")).toBeNull();
    });

    it("should throw error for invalid JSON", () => {
      const progressDir = join(process.cwd(), ".progress");
      if (!existsSync(progressDir)) {
        mkdirSync(progressDir, { recursive: true });
      }
      writeFileSync(join(progressDir, "invalid.json"), "invalid json");
      expect(() => loadProgressState("invalid")).toThrow();
    });
  });

  describe("deleteProgressState", () => {
    it("should delete existing progress state", () => {
      saveProgressState(testState);
      expect(loadProgressState(testBatchId)).not.toBeNull();
      deleteProgressState(testBatchId);
      expect(loadProgressState(testBatchId)).toBeNull();
    });

    it("should not throw error for non-existent batch", () => {
      expect(() => deleteProgressState("non-existent-batch")).not.toThrow();
    });
  });

  describe("listProgressStates", () => {
    it("should return empty array when no states exist", () => {
      const states = listProgressStates();
      // Filter out test states
      const nonTestStates = states.filter((s) => !s.batchId.startsWith("test-"));
      expect(nonTestStates.length).toBe(0);
    });

    it("should list all progress states", () => {
      const state1: ProgressState = {
        ...testState,
        batchId: "test-batch-1",
        timestamp: Date.now() - 1000,
      };
      const state2: ProgressState = {
        ...testState,
        batchId: "test-batch-2",
        timestamp: Date.now(),
      };

      saveProgressState(state1);
      saveProgressState(state2);

      const states = listProgressStates();
      const testStates = states.filter((s) => s.batchId.startsWith("test-"));
      expect(testStates.length).toBeGreaterThanOrEqual(2);
      expect(testStates.some((s) => s.batchId === "test-batch-1")).toBe(true);
      expect(testStates.some((s) => s.batchId === "test-batch-2")).toBe(true);
    });

    it("should sort states by timestamp descending", () => {
      const state1: ProgressState = {
        ...testState,
        batchId: "test-batch-old",
        timestamp: Date.now() - 2000,
      };
      const state2: ProgressState = {
        ...testState,
        batchId: "test-batch-new",
        timestamp: Date.now(),
      };

      saveProgressState(state1);
      saveProgressState(state2);

      const states = listProgressStates();
      const testStates = states.filter((s) => s.batchId.startsWith("test-"));
      const oldIndex = testStates.findIndex((s) => s.batchId === "test-batch-old");
      const newIndex = testStates.findIndex((s) => s.batchId === "test-batch-new");
      expect(newIndex).toBeLessThan(oldIndex);
    });
  });
});
