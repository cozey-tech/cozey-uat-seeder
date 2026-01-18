import { describe, it, expect, vi } from "vitest";
import { processWithConcurrency } from "./concurrency";

describe("processWithConcurrency", () => {
  it("should process all items", async () => {
    const items = [1, 2, 3, 4, 5];
    const handler = vi.fn(async (n: number) => n * 2);

    const result = await processWithConcurrency(items, handler, 5);

    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(handler).toHaveBeenCalledTimes(5);
  });

  it("should respect concurrency limit", async () => {
    const items = [1, 2, 3, 4, 5];
    const activeCount = { count: 0 };
    const maxConcurrent = { max: 0 };
    const handler = vi.fn(async (n: number) => {
      activeCount.count++;
      maxConcurrent.max = Math.max(maxConcurrent.max, activeCount.count);
      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCount.count--;
      return n * 2;
    });

    const limit = 2;
    await processWithConcurrency(items, handler, limit);

    // Max concurrent should not exceed limit
    expect(maxConcurrent.max).toBeLessThanOrEqual(limit);
    expect(handler).toHaveBeenCalledTimes(5);
  });

  it("should preserve order of results", async () => {
    const items = [3, 1, 4, 2, 5];
    // Handler that takes longer for smaller numbers (to test ordering)
    const handler = vi.fn(async (n: number) => {
      await new Promise((resolve) => setTimeout(resolve, (6 - n) * 5));
      return n * 2;
    });

    const result = await processWithConcurrency(items, handler, 2);

    // Results should be in same order as input, not completion order
    expect(result).toEqual([6, 2, 8, 4, 10]);
  });

  it("should handle empty array", async () => {
    const handler = vi.fn(async (n: number) => n * 2);

    const result = await processWithConcurrency([], handler, 5);

    expect(result).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("should handle errors gracefully", async () => {
    const items = [1, 2, 3];
    const handler = vi.fn(async (n: number) => {
      if (n === 2) {
        throw new Error("Test error");
      }
      return n * 2;
    });

    await expect(processWithConcurrency(items, handler, 2)).rejects.toThrow("Test error");
  });

  it("should use default limit of 5", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const handler = vi.fn(async (n: number) => n * 2);

    await processWithConcurrency(items, handler);

    expect(handler).toHaveBeenCalledTimes(10);
  });

  it("should handle single item", async () => {
    const handler = vi.fn(async (n: number) => n * 2);

    const result = await processWithConcurrency([42], handler, 1);

    expect(result).toEqual([84]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(42);
  });
});
