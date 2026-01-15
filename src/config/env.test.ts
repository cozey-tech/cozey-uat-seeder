import { describe, expect, it, beforeEach, vi } from "vitest";

import { getEnvConfig } from "./env";

describe("getEnvConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Clear module cache to reset cached config
    delete require.cache[require.resolve("./env")];
  });

  it("should return valid config when all required env vars are present", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
    process.env.SHOPIFY_ACCESS_TOKEN = "test-token";
    process.env.SHOPIFY_API_VERSION = "2024-01";

    const config = getEnvConfig();

    expect(config.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(config.SHOPIFY_STORE_DOMAIN).toBe("test-store.myshopify.com");
    expect(config.SHOPIFY_ACCESS_TOKEN).toBe("test-token");
    expect(config.SHOPIFY_API_VERSION).toBe("2024-01");
  });

  it("should use default API version when not provided", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
    process.env.SHOPIFY_ACCESS_TOKEN = "test-token";
    delete process.env.SHOPIFY_API_VERSION;

    const config = getEnvConfig();

    expect(config.SHOPIFY_API_VERSION).toBe("2024-01");
  });

  it("should throw error when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
    process.env.SHOPIFY_ACCESS_TOKEN = "test-token";

    expect(() => getEnvConfig()).toThrow("Missing or invalid required environment variables");
  });

  it("should throw error when SHOPIFY_STORE_DOMAIN is missing", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    delete process.env.SHOPIFY_STORE_DOMAIN;
    process.env.SHOPIFY_ACCESS_TOKEN = "test-token";

    expect(() => getEnvConfig()).toThrow("Missing or invalid required environment variables");
  });

  it("should throw error when SHOPIFY_ACCESS_TOKEN is missing", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
    delete process.env.SHOPIFY_ACCESS_TOKEN;

    expect(() => getEnvConfig()).toThrow("Missing or invalid required environment variables");
  });

  it("should throw error when DATABASE_URL is invalid URL", () => {
    process.env.DATABASE_URL = "not-a-valid-url";
    process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";
    process.env.SHOPIFY_ACCESS_TOKEN = "test-token";

    expect(() => getEnvConfig()).toThrow("Missing or invalid required environment variables");
  });
});
