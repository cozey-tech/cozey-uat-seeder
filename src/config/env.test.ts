import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock AwsSecretsService at module level
const mockFetchSecrets = vi.fn();
vi.mock("../services/AwsSecretsService", () => ({
  AwsSecretsService: vi.fn().mockImplementation(() => ({
    fetchSecrets: mockFetchSecrets,
  })),
}));

describe("env config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Disable AWS secrets for tests (use .env only)
    process.env.USE_AWS_SECRETS = "false";
    mockFetchSecrets.mockClear();
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

      // Default connection_limit should be applied
      expect(config.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db?connection_limit=10");
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

    it("should transform plain string AWS secrets to env var names", async () => {
      // Enable AWS secrets
      process.env.USE_AWS_SECRETS = "true";
      process.env.AWS_REGION = "us-east-1";
      process.env.AWS_DATABASE_SECRET_NAME = "dev/uat-database-url";
      process.env.AWS_SHOPIFY_SECRET_NAME = "dev/shopify-access-token";
      // Provide fallback values for missing secrets
      process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";

      // Mock AWS service to return plain string secrets (using secret names as keys)
      mockFetchSecrets.mockResolvedValueOnce({
        "dev/uat-database-url": "postgresql://user:pass@aws-db.example.com:5432/db",
        "dev/shopify-access-token": "aws-token-12345",
      });

      vi.resetModules();
      const { initializeEnvConfig } = await import("./env");
      const config = await initializeEnvConfig();

      // Verify plain string secrets were transformed to correct env var names
      // Default connection_limit should be applied
      expect(config.DATABASE_URL).toBe("postgresql://user:pass@aws-db.example.com:5432/db?connection_limit=10");
      expect(config.SHOPIFY_ACCESS_TOKEN).toBe("aws-token-12345");
      expect(config.SHOPIFY_STORE_DOMAIN).toBe("test-store.myshopify.com");
    });

    it("should handle JSON AWS secrets with correct keys", async () => {
      // Enable AWS secrets
      process.env.USE_AWS_SECRETS = "true";
      process.env.AWS_REGION = "us-east-1";
      process.env.AWS_DATABASE_SECRET_NAME = "dev/uat-database-url";
      process.env.AWS_SHOPIFY_SECRET_NAME = "dev/shopify-access-token";

      // Mock AWS service to return JSON secrets (already have correct env var names as keys)
      mockFetchSecrets.mockResolvedValueOnce({
        DATABASE_URL: "postgresql://user:pass@aws-db.example.com:5432/db",
        SHOPIFY_ACCESS_TOKEN: "aws-token-12345",
        SHOPIFY_STORE_DOMAIN: "aws-store.myshopify.com",
      });

      vi.resetModules();
      const { initializeEnvConfig } = await import("./env");
      const config = await initializeEnvConfig();

      // Verify JSON secrets are used as-is (already have correct keys)
      // Default connection_limit should be applied
      expect(config.DATABASE_URL).toBe("postgresql://user:pass@aws-db.example.com:5432/db?connection_limit=10");
      expect(config.SHOPIFY_ACCESS_TOKEN).toBe("aws-token-12345");
      expect(config.SHOPIFY_STORE_DOMAIN).toBe("aws-store.myshopify.com");
    });

    it("should handle mixed plain string and JSON AWS secrets", async () => {
      // Enable AWS secrets
      process.env.USE_AWS_SECRETS = "true";
      process.env.AWS_REGION = "us-east-1";
      process.env.AWS_DATABASE_SECRET_NAME = "dev/uat-database-url";
      process.env.AWS_SHOPIFY_SECRET_NAME = "dev/shopify-access-token";
      // Provide fallback for missing value
      process.env.SHOPIFY_STORE_DOMAIN = "test-store.myshopify.com";

      // Mock AWS service: database secret is plain string, shopify secret is JSON
      mockFetchSecrets.mockResolvedValueOnce({
        "dev/uat-database-url": "postgresql://user:pass@aws-db.example.com:5432/db", // Plain string
        SHOPIFY_ACCESS_TOKEN: "aws-token-12345", // JSON (already has correct key)
        SHOPIFY_STORE_DOMAIN: "aws-store.myshopify.com", // JSON (already has correct key)
      });

      vi.resetModules();
      const { initializeEnvConfig } = await import("./env");
      const config = await initializeEnvConfig();

      // Verify plain string secret was transformed, JSON secrets used as-is
      // Default connection_limit should be applied
      expect(config.DATABASE_URL).toBe("postgresql://user:pass@aws-db.example.com:5432/db?connection_limit=10");
      expect(config.SHOPIFY_ACCESS_TOKEN).toBe("aws-token-12345");
      expect(config.SHOPIFY_STORE_DOMAIN).toBe("aws-store.myshopify.com");
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

      // Default connection_limit should be applied
      expect(config.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db?connection_limit=10");
      expect(config.SHOPIFY_STORE_DOMAIN).toBe("test-store.myshopify.com");
      expect(config.SHOPIFY_ACCESS_TOKEN).toBe("test-token");
    });
  });
});
