import { describe, it, expect } from "vitest";
import { ErrorFormatter } from "./errorFormatter";
import { InputValidationError } from "../services/InputParserService";
import { DataValidationError } from "../services/DataValidationService";
import { StagingGuardrailError } from "../shared/errors/StagingGuardrailError";
import { ShopifyServiceError } from "../services/ShopifyService";
import { WmsServiceError } from "../services/WmsService";
import { CollectionPrepValidationError } from "../services/CollectionPrepService";

describe("ErrorFormatter", () => {
  describe("format", () => {
    it("should format InputValidationError", () => {
      const error = new InputValidationError("Invalid JSON format");
      const formatted = ErrorFormatter.format(error);

      expect(formatted.message).toContain("Configuration file");
      expect(formatted.suggestions.length).toBeGreaterThan(0);
      expect(formatted.suggestions[0]).toContain("JSON file");
    });

    it("should format DataValidationError", () => {
      const error = new DataValidationError("SKU 'INVALID-SKU' not found");
      const formatted = ErrorFormatter.format(error, { sku: "INVALID-SKU" });

      expect(formatted.message).toContain("SKU");
      expect(formatted.suggestions.length).toBeGreaterThan(0);
      expect(formatted.suggestions[0]).toContain("SKUs exist");
    });

    it("should format StagingGuardrailError", () => {
      const error = new StagingGuardrailError("Production database detected");
      const formatted = ErrorFormatter.format(error);

      expect(formatted.message).toContain("Staging environment");
      expect(formatted.suggestions.length).toBeGreaterThan(0);
      expect(formatted.suggestions[0]).toContain("DATABASE_URL");
    });

    it("should format ShopifyServiceError", () => {
      const error = new ShopifyServiceError("API request failed", [
        { message: "Variant not found", field: ["lineItems", "0", "variantId"] },
      ]);
      const formatted = ErrorFormatter.format(error);

      expect(formatted.message).toContain("Shopify");
      expect(formatted.suggestions.length).toBeGreaterThan(0);
      expect(formatted.suggestions[0]).toContain("Shopify API");
    });

    it("should format WmsServiceError", () => {
      const error = new WmsServiceError("Order already exists");
      const formatted = ErrorFormatter.format(error);

      expect(formatted.message).toContain("already exists");
      expect(formatted.suggestions.length).toBeGreaterThan(0);
      expect(formatted.suggestions.some((s) => s.includes("database"))).toBe(true);
    });

    it("should format CollectionPrepValidationError", () => {
      const error = new CollectionPrepValidationError("Order mix validation failed");
      const formatted = ErrorFormatter.format(error);

      expect(formatted.message).toContain("Collection prep");
      expect(formatted.suggestions.length).toBeGreaterThan(0);
    });

    it("should include context in formatted message", () => {
      const error = new DataValidationError("SKU not found");
      const formatted = ErrorFormatter.format(error, {
        step: "Step 2 (WMS seeding)",
        orderIndex: 3,
        customerEmail: "test@example.com",
        sku: "INVALID-SKU",
      });

      expect(formatted.context).toContain("Step 2");
      expect(formatted.context).toContain("Order: 3");
      expect(formatted.context).toContain("test@example.com");
      expect(formatted.context).toContain("INVALID-SKU");
    });

    it("should format generic Error", () => {
      const error = new Error("Something went wrong");
      const formatted = ErrorFormatter.format(error);

      expect(formatted.message).toBe("Something went wrong");
      expect(formatted.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("formatAsString", () => {
    it("should format error as console-ready string", () => {
      const error = new DataValidationError("SKU not found");
      const formatted = ErrorFormatter.formatAsString(error, {
        step: "Step 2",
        orderIndex: 1,
      });

      expect(formatted).toContain("❌");
      expect(formatted).toContain("💡");
      expect(formatted).toContain("Step 2");
      expect(formatted).toContain("Order: 1");
      expect(formatted).toContain("Suggestions:");
    });

    it("should include suggestions in formatted string", () => {
      const error = new InputValidationError("Invalid schema");
      const formatted = ErrorFormatter.formatAsString(error);

      expect(formatted).toContain("Suggestions:");
      expect(formatted).toContain("•");
    });

    it("should handle errors without context", () => {
      const error = new Error("Generic error");
      const formatted = ErrorFormatter.formatAsString(error);

      expect(formatted).toContain("❌");
      expect(formatted).toContain("Generic error");
    });
  });

  describe("context formatting", () => {
    it("should format context with all fields", () => {
      const error = new Error("Test");
      const formatted = ErrorFormatter.format(error, {
        step: "Step 1",
        orderIndex: 5,
        customerEmail: "customer@example.com",
        sku: "SKU-123",
      });

      expect(formatted.context).toContain("Step 1");
      expect(formatted.context).toContain("Order: 5");
      expect(formatted.context).toContain("customer@example.com");
      expect(formatted.context).toContain("SKU-123");
    });

    it("should handle partial context", () => {
      const error = new Error("Test");
      const formatted = ErrorFormatter.format(error, {
        step: "Step 2",
      });

      expect(formatted.context).toBe("Step: Step 2");
    });

    it("should return null context when no context provided", () => {
      const error = new Error("Test");
      const formatted = ErrorFormatter.format(error);

      expect(formatted.context).toBeUndefined();
    });
  });

  describe("error-specific formatting", () => {
    it("should format InputValidationError with file context", () => {
      const error = new InputValidationError("File not found: config.json");
      const formatted = ErrorFormatter.format(error);

      expect(formatted.message).toContain("file");
    });

    it("should format ShopifyServiceError with user errors", () => {
      const error = new ShopifyServiceError("Failed", [{ message: "Field required", field: ["customer", "email"] }]);
      const formatted = ErrorFormatter.format(error);

      expect(formatted.message).toContain("customer.email");
    });

    it("should format WmsServiceError with already exists message", () => {
      const error = new WmsServiceError("Order with shopifyOrderId X already exists");
      const formatted = ErrorFormatter.format(error);

      expect(formatted.message).toContain("already exists");
      expect(formatted.suggestions.some((s) => s.includes("idempotent"))).toBe(true);
    });
  });
});
