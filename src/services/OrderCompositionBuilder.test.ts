import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrderCompositionBuilder } from "./OrderCompositionBuilder";
import { InteractivePromptService } from "./InteractivePromptService";
import type { Variant } from "../repositories/ConfigDataRepository";
import type { OrderTemplate } from "./InteractivePromptService";

describe("OrderCompositionBuilder", () => {
  let builder: OrderCompositionBuilder;
  let mockPromptService: {
    promptVariantSelection: ReturnType<typeof vi.fn>;
    promptQuantity: ReturnType<typeof vi.fn>;
    promptPickType: ReturnType<typeof vi.fn>;
    promptConfirm: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPromptService = {
      promptVariantSelection: vi.fn(),
      promptQuantity: vi.fn(),
      promptPickType: vi.fn(),
      promptConfirm: vi.fn(),
    };

    builder = new OrderCompositionBuilder(mockPromptService as unknown as InteractivePromptService);
  });

  describe("buildFromTemplate", () => {
    it("should build order from template without modifications", async () => {
      const template: OrderTemplate = {
        id: "template-1",
        name: "Test Template",
        description: "Test",
        lineItems: [
          {
            sku: "SOFA-001-BLK",
            quantity: 2,
            pickType: "Regular",
          },
        ],
      };

      const variants: Variant[] = [];

      mockPromptService.promptConfirm.mockResolvedValue(false); // Don't modify

      const result = await builder.buildFromTemplate(template, variants);

      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].sku).toBe("SOFA-001-BLK");
      expect(result.lineItems[0].quantity).toBe(2);
    });

    it("should allow adding items to template", async () => {
      const template: OrderTemplate = {
        id: "template-1",
        name: "Test Template",
        description: "Test",
        lineItems: [
          {
            sku: "SOFA-001-BLK",
            quantity: 1,
            pickType: "Regular",
          },
        ],
      };

      const variants: Variant[] = [
        {
          id: "variant-1",
          sku: "CHAIR-001-WHT",
          modelName: "Chair",
          colorId: "WHT",
          shopifyIds: ["shopify-1"],
          region: "CA",
        },
      ];

      mockPromptService.promptConfirm
        .mockResolvedValueOnce(true) // Want to modify
        .mockResolvedValueOnce(true) // Add new item
        .mockResolvedValueOnce(false) // Don't modify existing
        .mockResolvedValueOnce(false) // Don't remove
        .mockResolvedValueOnce(true); // Done editing

      mockPromptService.promptVariantSelection.mockResolvedValue(variants);
      mockPromptService.promptQuantity.mockResolvedValue(2);
      mockPromptService.promptPickType.mockResolvedValue("Pick and Pack");

      const result = await builder.buildFromTemplate(template, variants);

      expect(result.lineItems.length).toBeGreaterThan(1);
      expect(mockPromptService.promptVariantSelection).toHaveBeenCalled();
    });
  });

  describe("buildCustom", () => {
    it("should build custom order", async () => {
      const variants: Variant[] = [
        {
          id: "variant-1",
          sku: "SOFA-001-BLK",
          modelName: "Sofa",
          colorId: "BLK",
          shopifyIds: ["shopify-1"],
          region: "CA",
        },
      ];

      mockPromptService.promptVariantSelection.mockResolvedValue(variants);
      mockPromptService.promptQuantity.mockResolvedValue(1);
      mockPromptService.promptPickType.mockResolvedValue("Regular");
      mockPromptService.promptConfirm.mockResolvedValue(false); // Don't add more

      const result = await builder.buildCustom(variants);

      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].sku).toBe("SOFA-001-BLK");
      expect(mockPromptService.promptVariantSelection).toHaveBeenCalled();
    });

    it("should allow adding multiple items", async () => {
      const variants: Variant[] = [
        {
          id: "variant-1",
          sku: "SOFA-001-BLK",
          modelName: "Sofa",
          colorId: "BLK",
          shopifyIds: ["shopify-1"],
          region: "CA",
        },
      ];

      mockPromptService.promptVariantSelection.mockResolvedValue(variants);
      mockPromptService.promptQuantity.mockResolvedValue(1);
      mockPromptService.promptPickType.mockResolvedValue("Regular");
      mockPromptService.promptConfirm
        .mockResolvedValueOnce(true) // Add more
        .mockResolvedValueOnce(false); // Done

      const result = await builder.buildCustom(variants);

      expect(result.lineItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("validateComposition", () => {
    it("should throw error if no line items", () => {
      expect(() => {
        builder.validateComposition({ lineItems: [] });
      }).toThrow("Order must have at least one line item");
    });

    it("should throw error if quantity < 1", () => {
      expect(() => {
        builder.validateComposition({
          lineItems: [
            {
              sku: "SOFA-001-BLK",
              quantity: 0,
              pickType: "Regular",
            },
          ],
        });
      }).toThrow("must have quantity >= 1");
    });

    it("should throw error if invalid pickType", () => {
      expect(() => {
        builder.validateComposition({
          lineItems: [
            {
              sku: "SOFA-001-BLK",
              quantity: 1,
              pickType: "Invalid" as "Regular",
            },
          ],
        });
      }).toThrow("invalid pickType");
    });

    it("should pass validation for valid composition", () => {
      expect(() => {
        builder.validateComposition({
          lineItems: [
            {
              sku: "SOFA-001-BLK",
              quantity: 1,
              pickType: "Regular",
            },
          ],
        });
      }).not.toThrow();
    });
  });
});
