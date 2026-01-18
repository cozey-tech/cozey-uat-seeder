import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ProgressTracker } from "./progress";

// Mock ora to avoid actual spinner output in tests
vi.mock("ora", () => {
  const mockSpinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: "",
  };

  return {
    default: vi.fn(() => mockSpinner),
  };
});

describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("start", () => {
    it("should initialize progress tracking", () => {
      tracker.start("Test operation", 10);
      expect(tracker.getPercentage()).toBe(0);
      expect(tracker.getElapsedTime()).toBe(0);
    });

    it("should start with current = 0", () => {
      tracker.start("Test", 5);
      expect(tracker.getPercentage()).toBe(0);
    });
  });

  describe("update", () => {
    it("should update progress correctly", () => {
      tracker.start("Test", 10);
      tracker.update(5);
      expect(tracker.getPercentage()).toBe(50);
    });

    it("should throw error if current is out of bounds", () => {
      tracker.start("Test", 10);
      expect(() => tracker.update(0)).toThrow();
      expect(() => tracker.update(11)).toThrow();
    });

    it("should track elapsed time", () => {
      tracker.start("Test", 10);
      vi.advanceTimersByTime(1000);
      tracker.update(1);
      expect(tracker.getElapsedTime()).toBeGreaterThan(0);
    });
  });

  describe("complete", () => {
    it("should mark progress as complete", () => {
      tracker.start("Test", 10);
      tracker.update(10);
      tracker.complete("Done");
      expect(tracker.getPercentage()).toBe(0); // Reset after complete
    });
  });

  describe("fail", () => {
    it("should mark progress as failed", () => {
      tracker.start("Test", 10);
      tracker.fail("Error occurred");
      expect(tracker.getPercentage()).toBe(0); // Reset after fail
    });
  });

  describe("estimateTimeRemaining", () => {
    it("should return empty string if no progress made", () => {
      tracker.start("Test", 10);
      const estimate = tracker.estimateTimeRemaining();
      expect(estimate).toBe("");
    });

    it("should estimate time based on average operation time", () => {
      tracker.start("Test", 10);
      // Simulate some operations
      vi.advanceTimersByTime(1000);
      tracker.update(1);
      vi.advanceTimersByTime(1000);
      tracker.update(2);
      // Should have estimate for remaining 8 items
      const estimate = tracker.estimateTimeRemaining();
      expect(estimate).toBeTruthy();
    });
  });

  describe("formatDuration", () => {
    it("should format milliseconds correctly", () => {
      tracker.start("Test", 10);
      vi.advanceTimersByTime(500);
      tracker.update(1);
      const elapsed = tracker.getElapsedTime();
      expect(elapsed).toBe(500);
    });

    it("should format seconds correctly", () => {
      tracker.start("Test", 10);
      vi.advanceTimersByTime(5000);
      tracker.update(1);
      const elapsed = tracker.getElapsedTime();
      expect(elapsed).toBe(5000);
    });
  });

  describe("getPercentage", () => {
    it("should return 0 for empty progress", () => {
      expect(tracker.getPercentage()).toBe(0);
    });

    it("should calculate percentage correctly", () => {
      tracker.start("Test", 10);
      tracker.update(3);
      expect(tracker.getPercentage()).toBe(30);
    });

    it("should return 100 when complete", () => {
      tracker.start("Test", 10);
      tracker.update(10);
      expect(tracker.getPercentage()).toBe(100);
    });
  });

  describe("options", () => {
    it("should work without spinner", () => {
      const noSpinnerTracker = new ProgressTracker({ showSpinner: false });
      noSpinnerTracker.start("Test", 10);
      noSpinnerTracker.update(5);
      noSpinnerTracker.complete();
      // Should not throw
      expect(noSpinnerTracker.getPercentage()).toBe(0);
    });

    it("should work with custom message formatter", () => {
      const customTracker = new ProgressTracker({
        formatMessage: (current, total) => `Custom: ${current}/${total}`,
      });
      customTracker.start("Test", 10);
      customTracker.update(5);
      customTracker.complete();
      // Should not throw
      expect(customTracker.getPercentage()).toBe(0);
    });
  });
});
