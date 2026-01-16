import { describe, it, expect, beforeEach, vi } from "vitest";
import { InteractivePromptService, type OrderTemplate, type InventoryCheckResult } from "./InteractivePromptService";
import type { Customer, Variant, Carrier } from "../repositories/ConfigDataRepository";
import inquirer from "inquirer";
import { search } from "@inquirer/prompts";

// Mock inquirer
vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
    Separator: class Separator {
      constructor(public line?: string) {}
    },
  },
}));

// Mock @inquirer/prompts
vi.mock("@inquirer/prompts", () => ({
  search: vi.fn(),
}));

describe("InteractivePromptService", () => {
  let service: InteractivePromptService;

  beforeEach(() => {
    service = new InteractivePromptService();
    vi.clearAllMocks();
    // Mock console.log to avoid cluttering test output
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Reset search mock for each test
    vi.mocked(search).mockReset();
  });

  describe("promptOrderCount", () => {
    it("should return order count", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ count: "5" });

      const result = await service.promptOrderCount();

      expect(result).toBe(5);
      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: "input",
            name: "count",
            message: "How many orders would you like to create?",
          }),
        ]),
      );
    });

    it("should parse count as integer", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ count: "10" });

      const result = await service.promptOrderCount();

      expect(result).toBe(10);
    });
  });

  describe("promptRegion", () => {
    it("should return selected region", async () => {
      const mockPrompt = vi.mocked(inquirer.prompt);
      mockPrompt.mockResolvedValue({ region: "CA" });

      const result = await service.promptRegion();

      expect(result).toBe("CA");
      expect(mockPrompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: "list",
            name: "region",
            choices: expect.arrayContaining([
              { name: "Canada (CA)", value: "CA" },
              { name: "United States (US)", value: "US" },
            ]),
          }),
        ]),
      );
    });
  });

  describe("promptCustomerSelection", () => {
    it("should return selected customer", async () => {
      const customers: Customer[] = [
        {
          id: "customer-1",
          name: "Test Customer",
          email: "test@example.com",
          region: "CA",
          locationId: "langley",
        },
        {
          id: "customer-2",
          name: "Test Customer 2",
          email: "test2@example.com",
          region: "CA",
          locationId: "windsor",
        },
      ];

      vi.mocked(inquirer.prompt).mockResolvedValue({ customerId: "customer-1" });

      const result = await service.promptCustomerSelection(customers);

      expect(result.id).toBe("customer-1");
      expect(result.locationId).toBe("langley");
    });

    it("should throw error if customer not found", async () => {
      const customers: Customer[] = [
        {
          id: "customer-1",
          name: "Test Customer",
          email: "test@example.com",
          region: "CA",
          locationId: "langley",
        },
      ];

      vi.mocked(inquirer.prompt).mockResolvedValue({ customerId: "invalid" });

      await expect(service.promptCustomerSelection(customers)).rejects.toThrow("Customer invalid not found");
    });
  });

  describe("promptOrderComposition", () => {
    it("should return composition type", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ compositionType: "template" });

      const result = await service.promptOrderComposition([], []);

      expect(result).toBe("template");
    });
  });

  describe("promptTemplateSelection", () => {
    it("should return selected template", async () => {
      const templates: OrderTemplate[] = [
        {
          id: "template-1",
          name: "Test Template",
          description: "Test description",
          lineItems: [],
        },
      ];

      vi.mocked(inquirer.prompt).mockResolvedValue({ templateId: "template-1" });

      const result = await service.promptTemplateSelection(templates);

      expect(result.id).toBe("template-1");
    });
  });

  describe("promptVariantSelection", () => {
    it("should return selected variants with hierarchical selection", async () => {
      const variants: Variant[] = [
        {
          id: "variant-1",
          sku: "SOFA-001-BLK",
          modelName: "Sofa",
          colorId: "BLK",
          shopifyIds: ["shopify-1"],
          region: "CA",
          description: "Sofa - Black",
          pickType: "Regular",
        },
        {
          id: "variant-2",
          sku: "SOFA-001-WHT",
          modelName: "Sofa",
          colorId: "WHT",
          shopifyIds: ["shopify-2"],
          region: "CA",
          description: "Sofa - White",
          pickType: "Regular",
        },
        {
          id: "variant-3",
          sku: "CHAIR-001-BLK",
          modelName: "Chair",
          colorId: "BLK",
          shopifyIds: ["shopify-3"],
          region: "CA",
          description: "Chair - Black",
          pickType: "Pick and Pack",
        },
      ];

      // Mock the new hierarchical flow with live search:
      // 1. Model selection (search) - returns "Sofa"
      // 2. Color selection (search) - returns "BLK"
      // 3. Configuration selection (auto if only one, or search) - auto-selected "Standard"
      // 4. Variant selection (search, multi-select) - select "SOFA-001-BLK"
      // 5. Done selecting variants - true
      // 6. Add more products - false
      vi.mocked(search)
        .mockResolvedValueOnce("Sofa") // Model selection
        .mockResolvedValueOnce("BLK") // Color selection
        .mockResolvedValueOnce("SOFA-001-BLK"); // Variant selection
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ done: true }) // Done selecting variants
        .mockResolvedValueOnce({ addMore: false }); // Don't add more

      const result = await service.promptVariantSelection(variants);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("variant-1");
      expect(search).toHaveBeenCalledTimes(3); // Model, color, variant (config auto-selected)
      expect(inquirer.prompt).toHaveBeenCalledTimes(2); // Done, addMore
    });

    it("should support filtering models by search term", async () => {
      const variants: Variant[] = [
        {
          id: "variant-1",
          sku: "SOFA-001-BLK",
          modelName: "Sofa",
          colorId: "BLK",
          shopifyIds: ["shopify-1"],
          region: "CA",
          description: "Sofa - Black",
          pickType: "Regular",
        },
        {
          id: "variant-3",
          sku: "CHAIR-001-BLK",
          modelName: "Chair",
          colorId: "BLK",
          shopifyIds: ["shopify-3"],
          region: "CA",
          description: "Chair - Black",
          pickType: "Pick and Pack",
        },
      ];

      // Search for "Sofa" to filter (live search now handles this)
      vi.mocked(search)
        .mockResolvedValueOnce("Sofa") // Model selection (search filters live)
        .mockResolvedValueOnce("BLK") // Color selection
        .mockResolvedValueOnce("SOFA-001-BLK"); // Variant selection
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ done: true }) // Done selecting variants
        .mockResolvedValueOnce({ addMore: false }); // Don't add more

      const result = await service.promptVariantSelection(variants);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("variant-1");
    });

    it("should allow adding multiple products", async () => {
      const variants: Variant[] = [
        {
          id: "variant-1",
          sku: "SOFA-001-BLK",
          modelName: "Sofa",
          colorId: "BLK",
          shopifyIds: ["shopify-1"],
          region: "CA",
          description: "Sofa - Black",
          pickType: "Regular",
        },
        {
          id: "variant-3",
          sku: "CHAIR-001-BLK",
          modelName: "Chair",
          colorId: "BLK",
          shopifyIds: ["shopify-3"],
          region: "CA",
          description: "Chair - Black",
          pickType: "Pick and Pack",
        },
      ];

      // First product
      vi.mocked(search)
        .mockResolvedValueOnce("Sofa") // Model
        .mockResolvedValueOnce("BLK") // Color
        .mockResolvedValueOnce("SOFA-001-BLK") // Variant
        // Second product
        .mockResolvedValueOnce("Chair") // Model
        .mockResolvedValueOnce("BLK") // Color
        .mockResolvedValueOnce("CHAIR-001-BLK"); // Variant
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ done: true }) // Done selecting variants (first product)
        .mockResolvedValueOnce({ addMore: true }) // Add more
        .mockResolvedValueOnce({ done: true }) // Done selecting variants (second product)
        .mockResolvedValueOnce({ addMore: false }); // Done

      const result = await service.promptVariantSelection(variants);

      expect(result).toHaveLength(2);
      expect(result.map((v) => v.id)).toEqual(expect.arrayContaining(["variant-1", "variant-3"]));
    });
  });

  describe("promptQuantity", () => {
    it("should return quantity", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ quantity: "3" });

      const result = await service.promptQuantity("SOFA-001-BLK");

      expect(result).toBe(3);
    });

    it("should validate max quantity", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ quantity: "5" });

      const result = await service.promptQuantity("SOFA-001-BLK", 10);

      expect(result).toBe(5);
    });
  });

  describe("promptPickType", () => {
    it("should return pick type", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ pickType: "Pick and Pack" });

      const result = await service.promptPickType();

      expect(result).toBe("Pick and Pack");
    });
  });

  describe("promptCollectionPrepCount", () => {
    it("should return collection prep count with suggestion", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ count: "2" });

      const result = await service.promptCollectionPrepCount(10);

      expect(result).toBe(2);
      // Should suggest 2 (ceil(10/5))
      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            default: "2",
          }),
        ]),
      );
    });
  });

  describe("promptCarrierSelection", () => {
    it("should return selected carrier", async () => {
      const carriers: Carrier[] = [
        { id: "CANPAR", name: "Canpar", region: "CA" },
        { id: "FEDEX", name: "FedEx", region: "CA" },
      ];

      vi.mocked(inquirer.prompt).mockResolvedValue({ carrierId: "CANPAR" });

      const result = await service.promptCarrierSelection(carriers);

      expect(result.id).toBe("CANPAR");
    });
  });

  describe("promptSaveLocation", () => {
    it("should return file path", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ filePath: "my-config.json" });

      const result = await service.promptSaveLocation();

      expect(result).toBe("my-config.json");
    });

    it("should use default path", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ filePath: "seed-config.json" });

      const result = await service.promptSaveLocation("seed-config.json");

      expect(result).toBe("seed-config.json");
    });
  });

  describe("promptInventoryModification", () => {
    it("should return false if inventory is sufficient", async () => {
      const check: InventoryCheckResult = {
        sufficient: true,
        shortages: [],
      };

      const result = await service.promptInventoryModification(check);

      expect(result).toBe(false);
      expect(inquirer.prompt).not.toHaveBeenCalled();
    });

    it("should prompt if inventory insufficient", async () => {
      const check: InventoryCheckResult = {
        sufficient: false,
        shortages: [
          {
            partId: "part-1",
            sku: "SOFA-001",
            required: 10,
            available: 5,
            shortfall: 5,
          },
        ],
      };

      vi.mocked(inquirer.prompt).mockResolvedValue({ shouldModify: true });

      const result = await service.promptInventoryModification(check);

      expect(result).toBe(true);
      expect(inquirer.prompt).toHaveBeenCalled();
    });
  });

  describe("promptConfirm", () => {
    it("should return confirmation result", async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirmed: true });

      const result = await service.promptConfirm("Are you sure?");

      expect(result).toBe(true);
      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: "confirm",
            message: "Are you sure?",
          }),
        ]),
      );
    });
  });
});
