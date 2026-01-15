import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

import { InputParserService, InputValidationError } from "./InputParserService";
import { readJsonFile, readCsvFile } from "../utils/fileReader";

// Mock file reader utilities
vi.mock("../utils/fileReader", () => ({
  readJsonFile: vi.fn(),
  readCsvFile: vi.fn(),
}));

describe("InputParserService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseInputFile", () => {
    it("should parse valid JSON file", () => {
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
                pickType: "Regular",
              },
            ],
          },
        ],
      };

      vi.mocked(readJsonFile).mockReturnValue(validConfig);

      const service = new InputParserService();
      const result = service.parseInputFile("test.json");

      expect(result).toEqual(validConfig);
      expect(readJsonFile).toHaveBeenCalledWith("test.json");
    });

    it("should throw InputValidationError for invalid JSON structure", () => {
      const invalidConfig = {
        orders: "not-an-array",
      };

      vi.mocked(readJsonFile).mockReturnValue(invalidConfig);

      const service = new InputParserService();

      expect(() => service.parseInputFile("test.json")).toThrow(InputValidationError);
      expect(() => service.parseInputFile("test.json")).toThrow("Input file validation failed");
    });

    it("should throw InputValidationError for missing required fields", () => {
      const invalidConfig = {
        // Missing orders
      };

      vi.mocked(readJsonFile).mockReturnValue(invalidConfig);

      const service = new InputParserService();

      expect(() => service.parseInputFile("test.json")).toThrow(InputValidationError);
    });

    it("should throw InputValidationError for CSV files (not yet implemented)", () => {
      const service = new InputParserService();

      expect(() => service.parseInputFile("test.csv")).toThrow(InputValidationError);
      expect(() => service.parseInputFile("test.csv")).toThrow("CSV input format not yet implemented");
    });

    it("should throw InputValidationError for unsupported file format", () => {
      const service = new InputParserService();

      vi.mocked(readJsonFile).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(() => service.parseInputFile("test.txt")).toThrow(InputValidationError);
      expect(() => service.parseInputFile("test.txt")).toThrow("Unsupported file format");
    });

    it("should handle file read errors", () => {
      vi.mocked(readJsonFile).mockImplementation(() => {
        throw new Error("File not found");
      });

      const service = new InputParserService();

      expect(() => service.parseInputFile("missing.json")).toThrow("File not found");
    });
  });
});
