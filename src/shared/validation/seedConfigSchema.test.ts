import { describe, expect, it } from "vitest";

import { seedConfigSchema } from "./seedConfigSchema";

describe("seedConfigSchema", () => {
  describe("valid input", () => {
    it("should validate a complete config with collection prep", () => {
      const validConfig = {
        collectionPrep: {
          carrier: "UPS",
          locationId: "loc-123",
          region: "US",
          prepDate: "2026-01-15T10:00:00Z",
        },
        orders: [
          {
            orderType: "regular-only",
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 2,
                pickType: "Regular",
                hasBarcode: true,
              },
            ],
          },
        ],
      };

      const result = seedConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should validate config without collection prep", () => {
      const validConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: "Pick and Pack",
              },
            ],
          },
        ],
      };

      const result = seedConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should validate config with PnP config", () => {
      const validConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: "Pick and Pack",
              },
            ],
          },
        ],
        pnpConfig: {
          packageInfo: [
            {
              identifier: "PKG-001",
              dimensions: { length: 10, width: 8, height: 6 },
              weight: 1.5,
            },
          ],
          boxes: [
            {
              identifier: "BOX-001",
              dimensions: { length: 12, width: 10, height: 8 },
            },
          ],
        },
      };

      const result = seedConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });
  });

  describe("invalid input", () => {
    it("should reject invalid email", () => {
      const invalidConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "invalid-email",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: "Regular",
              },
            ],
          },
        ],
      };

      const result = seedConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("should reject negative quantity", () => {
      const invalidConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: -1,
                pickType: "Regular",
              },
            ],
          },
        ],
      };

      const result = seedConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("should reject invalid pickType", () => {
      const invalidConfig = {
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: "Invalid",
              },
            ],
          },
        ],
      };

      const result = seedConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("should reject invalid datetime format", () => {
      const invalidConfig = {
        collectionPrep: {
          carrier: "UPS",
          locationId: "loc-123",
          region: "US",
          prepDate: "invalid-date",
        },
        orders: [
          {
            customer: {
              name: "Test Customer",
              email: "test@example.com",
            },
            lineItems: [
              {
                sku: "SKU-001",
                quantity: 1,
                pickType: "Regular",
              },
            ],
          },
        ],
      };

      const result = seedConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });
});
