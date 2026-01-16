import { describe, expect, it, beforeEach, vi } from "vitest";

describe("env config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Disable AWS secrets for tests (use .env only)
    process.env.USE_AWS_SECRETS = "false";
    vi.resetModules();
  });

  describe("initializeEnvConfig", () => {
    it("should initialize config from .env when AWS is disabled", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
      process.env.SHOPIFY_ACCESS_TOKEN = "test-token";
      process.env.SHOPIFY_API_VERSION = "2024-01";

      const { initializeEnvConfig } = await import("./env");
      const config = await initializeEnvConfig();

      expect(config.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
      expect(config.SHOPIFY_STORE_DOMAIN).toBe("test-store.myshopify.com");
      expect(config.SHOPIFY_ACCESS_TOKEN).toBe("test-token");
      expect(config.SHOPIFY_API_VERSION).toBe("2024-01");
    });

    it("should use default API version when not provided", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
      process.env.SHOPIFY_ACCESS_TOKEN = "test-token";
      delete process.env.SHOPIFY_API_VERSION;

      const { initializeEnvConfig } = await import("./env");
      const config = await initializeEnvConfig();

      expect(config.SHOPIFY_API_VERSION).toBe("2024-01");
    });

    it("should throw error when DATABASE_URL is missing", async () => {
      delete process.env.DATABASE_URL;
      process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
      process.env.SHOPIFY_ACCESS_TOKEN = "test-token";

      const { initializeEnvConfig } = await import("./env");
      await expect(initializeEnvConfig()).rejects.toThrow("Missing or invalid required environment variables");
    });

    it("should throw error when SHOPIFY_STORE_DOMAIN is missing", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      delete process.env.SHOPIFY_STORE_DOMAIN;
      process.env.SHOPIFY_ACCESS_TOKEN = "test-token";

      const { initializeEnvConfig } = await import("./env");
      await expect(initializeEnvConfig()).rejects.toThrow("Missing or invalid required environment variables");
    });

    it("should throw error when SHOPIFY_ACCESS_TOKEN is missing", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
      delete process.env.SHOPIFY_ACCESS_TOKEN;

      const { initializeEnvConfig } = await import("./env");
      await expect(initializeEnvConfig()).rejects.toThrow("Missing or invalid required environment variables");
    });

    it("should throw error when DATABASE_URL is invalid URL", async () => {
      process.env.DATABASE_URL = "not-a-valid-url";
      process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
      process.env.SHOPIFY_ACCESS_TOKEN = "test-token";

      const { initializeEnvConfig } = await import("./env");
      await expect(initializeEnvConfig()).rejects.toThrow("Missing or invalid required environment variables");
    });
  });

  describe("getEnvConfig", () => {
    it("should throw error if called before initializeEnvConfig", async () => {
      const { getEnvConfig } = await import("./env");
      expect(() => getEnvConfig()).toThrow("Environment configuration not initialized");
    });

    it("should return config after initialization", async () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
      process.env.SHOPIFY_ACCESS_TOKEN = "test-token";

      const { initializeEnvConfig, getEnvConfig } = await import("./env");
      await initializeEnvConfig();
      const config = getEnvConfig();

      expect(config.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
      expect(config.SHOPIFY_STORE_DOMAIN).toBe("test-store.myshopify.com");
      expect(config.SHOPIFY_ACCESS_TOKEN).toBe("test-token");
    });
  });
});
