import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Logger } from "./logger";

describe("Logger", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Reset log level
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
  });

  describe("basic logging", () => {
    it("should log info messages", () => {
      Logger.info("Test message");
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(JSON.parse(call)).toMatchObject({
        level: "info",
        message: "Test message",
      });
    });

    it("should log warn messages", () => {
      Logger.warn("Warning message");
      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0][0];
      expect(JSON.parse(call)).toMatchObject({
        level: "warn",
        message: "Warning message",
      });
    });

    it("should log error messages", () => {
      Logger.error("Error message");
      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0][0];
      expect(JSON.parse(call)).toMatchObject({
        level: "error",
        message: "Error message",
      });
    });

    it("should log debug messages", () => {
      Logger.debug("Debug message");
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(JSON.parse(call)).toMatchObject({
        level: "debug",
        message: "Debug message",
      });
    });

    it("should include context in logs", () => {
      Logger.info("Test message", { key: "value", count: 42 });
      const call = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.context).toMatchObject({
        key: "value",
        count: 42,
      });
    });

    it("should mask email addresses in context", () => {
      Logger.info("Test message", { email: "test@example.com" });
      const call = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.context.email).toMatch(/^te\*\*\*@example\.com$/);
    });

    it("should format Error objects in error logs", () => {
      const error = new Error("Test error");
      Logger.error("Error occurred", error);
      const call = consoleErrorSpy.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.context.error).toMatchObject({
        message: "Test error",
        name: "Error",
      });
    });
  });

  describe("operation tracking", () => {
    it("should start and end operations", () => {
      const operationId = Logger.startOperation("testOperation", { key: "value" });
      expect(operationId).toBeTruthy();
      expect(consoleLogSpy).toHaveBeenCalled();

      Logger.endOperation(operationId, true, { result: "success" });
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it("should track operation duration", (done) => {
      const operationId = Logger.startOperation("testOperation");
      setTimeout(() => {
        Logger.endOperation(operationId, true);
        const calls = consoleLogSpy.mock.calls;
        const endCall = calls[calls.length - 1][0];
        const parsed = JSON.parse(endCall);
        expect(parsed.context.duration).toBeGreaterThan(0);
        done();
      }, 10);
    });

    it("should log failed operations as warnings", () => {
      const operationId = Logger.startOperation("testOperation");
      Logger.endOperation(operationId, false, { error: "Failed" });
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });

  describe("performance logging", () => {
    it("should log performance metrics", () => {
      Logger.performance({
        operation: "testOperation",
        duration: 100,
        itemCount: 10,
      });
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.context).toMatchObject({
        type: "performance",
        operation: "testOperation",
        duration: 100,
        itemCount: 10,
      });
    });
  });

  describe("context helpers", () => {
    it("should create logger with base context", () => {
      const logger = Logger.withContext({ batchId: "test-123" });
      logger.info("Test message", { orderId: "order-1" });
      const call = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.context).toMatchObject({
        batchId: "test-123",
        orderId: "order-1",
      });
    });
  });

  describe("log level filtering", () => {
    it("should filter debug logs when level is info", () => {
      process.env.LOG_LEVEL = "info";
      Logger.debug("Debug message");
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should show info logs when level is info", () => {
      process.env.LOG_LEVEL = "info";
      Logger.info("Info message");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should show warn logs when level is info", () => {
      process.env.LOG_LEVEL = "info";
      Logger.warn("Warning message");
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it("should show error logs when level is info", () => {
      process.env.LOG_LEVEL = "info";
      Logger.error("Error message");
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("should filter info logs when level is warn", () => {
      process.env.LOG_LEVEL = "warn";
      Logger.info("Info message");
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should show warn logs when level is warn", () => {
      process.env.LOG_LEVEL = "warn";
      Logger.warn("Warning message");
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });

  describe("trackOperation", () => {
    it("should track successful async operations", async () => {
      const result = await Logger.trackOperation("testOperation", async () => {
        return "success";
      });
      expect(result).toBe("success");
      expect(consoleLogSpy).toHaveBeenCalledTimes(2); // start and end
    });

    it("should track failed async operations", async () => {
      await expect(
        Logger.trackOperation("testOperation", async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow("Test error");
      expect(consoleLogSpy).toHaveBeenCalled(); // start
      expect(consoleWarnSpy).toHaveBeenCalled(); // end with failure
    });
  });
});
