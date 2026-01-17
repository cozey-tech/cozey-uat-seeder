import { describe, expect, it, beforeEach, vi } from "vitest";

import { assertStagingEnvironment, displayStagingEnvironment, requireExplicitStagingConfirmation } from "./stagingGuardrails";
import { StagingGuardrailError } from "../shared/errors/StagingGuardrailError";

// Mock the env module
vi.mock("./env", () => ({
  getEnvConfig: vi.fn(),
  areSecretsFromAws: vi.fn(),
}));

import { getEnvConfig, areSecretsFromAws } from "./env";

describe("stagingGuardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to secrets NOT from AWS (normal validation behavior)
    vi.mocked(areSecretsFromAws).mockReturnValue(false);
  });

  describe("assertStagingEnvironment", () => {
    it("should skip validation when secrets come from AWS", () => {
      vi.mocked(areSecretsFromAws).mockReturnValue(true);
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:pass@production-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "production-store.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      expect(() => assertStagingEnvironment()).not.toThrow();
    });

    it("should pass for staging DB URL with 'staging'", () => {
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:pass@staging-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "staging-store.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      expect(() => assertStagingEnvironment()).not.toThrow();
    });

    it("should pass for staging DB URL with 'test'", () => {
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:pass@test-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "test-store.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      expect(() => assertStagingEnvironment()).not.toThrow();
    });

    it("should throw for production-like DB URL", () => {
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:pass@production-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "staging-store.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      expect(() => assertStagingEnvironment()).toThrow(StagingGuardrailError);
      expect(() => assertStagingEnvironment()).toThrow("Database URL does not match staging patterns");
    });

    it("should throw for production-like Shopify domain", () => {
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:pass@staging-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "production-store.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      expect(() => assertStagingEnvironment()).toThrow(StagingGuardrailError);
      expect(() => assertStagingEnvironment()).toThrow("Shopify domain does not match staging patterns");
    });
  });

  describe("displayStagingEnvironment", () => {
    it("should return isStaging true when secrets come from AWS", () => {
      vi.mocked(areSecretsFromAws).mockReturnValue(true);
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:password@production-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "production-store.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      const result = displayStagingEnvironment();

      expect(result.isStaging).toBe(true);
      expect(result.databaseUrl).toContain("***");
    });

    it("should return masked DB URL and Shopify domain", () => {
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:password@staging-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "staging-store.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      const result = displayStagingEnvironment();

      expect(result.databaseUrl).toContain("***");
      expect(result.databaseUrl).not.toContain("password");
      expect(result.shopifyDomain).toBe("staging-store.myshopify.com");
      expect(result.isStaging).toBe(true);
    });

    it("should return isStaging false for production-like URLs", () => {
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:pass@production-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "production-store.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      const result = displayStagingEnvironment();

      expect(result.isStaging).toBe(false);
    });
  });

  describe("requireExplicitStagingConfirmation", () => {
    it("should skip validation when secrets come from AWS", async () => {
      vi.mocked(areSecretsFromAws).mockReturnValue(true);
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:pass@production-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "production-store.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      await expect(requireExplicitStagingConfirmation(false)).resolves.not.toThrow();
    });

    it("should not throw when skipConfirmation is true", async () => {
      await expect(requireExplicitStagingConfirmation(true)).resolves.not.toThrow();
    });

    it("should not throw when environment is staging", async () => {
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:pass@staging-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "staging-store.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      await expect(requireExplicitStagingConfirmation(false)).resolves.not.toThrow();
    });

    it("should throw when environment is not staging", async () => {
      vi.mocked(getEnvConfig).mockReturnValue({
        DATABASE_URL: "postgresql://user:pass@production-db.example.com:5432/db",
        SHOPIFY_STORE_DOMAIN: "production-store.com",
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_API_VERSION: "2024-01",
      });

      await expect(requireExplicitStagingConfirmation(false)).rejects.toThrow(StagingGuardrailError);
    });
  });
});
