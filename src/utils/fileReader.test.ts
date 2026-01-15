import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

import { readJsonFile, readCsvFile } from "./fileReader";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

vi.mock("csv-parse/sync", () => ({
  parse: vi.fn(),
}));

describe("fileReader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("readJsonFile", () => {
    it("should parse valid JSON file", () => {
      const jsonContent = '{"key": "value"}';
      vi.mocked(readFileSync).mockReturnValue(jsonContent);

      const result = readJsonFile("test.json");

      expect(result).toEqual({ key: "value" });
      expect(readFileSync).toHaveBeenCalledWith("test.json", "utf-8");
    });

    it("should throw error for invalid JSON", () => {
      const invalidJson = "{ invalid json }";
      vi.mocked(readFileSync).mockReturnValue(invalidJson);

      expect(() => readJsonFile("test.json")).toThrow("Invalid JSON");
    });

    it("should throw error for missing file", () => {
      const error = new Error("ENOENT");
      (error as { code?: string }).code = "ENOENT";
      vi.mocked(readFileSync).mockImplementation(() => {
        throw error;
      });

      expect(() => readJsonFile("missing.json")).toThrow("File not found");
    });
  });

  describe("readCsvFile", () => {
    it("should parse valid CSV file", async () => {
      const csvContent = "name,email\nJohn,john@example.com";
      vi.mocked(readFileSync).mockReturnValue(csvContent);

      const { parse } = await import("csv-parse/sync");
      vi.mocked(parse).mockReturnValue([{ name: "John", email: "john@example.com" }]);

      const result = readCsvFile("test.csv");

      expect(result).toEqual([{ name: "John", email: "john@example.com" }]);
    });

    it("should throw error for missing CSV file", () => {
      const error = new Error("ENOENT");
      (error as { code?: string }).code = "ENOENT";
      vi.mocked(readFileSync).mockImplementation(() => {
        throw error;
      });

      expect(() => readCsvFile("missing.csv")).toThrow("File not found");
    });
  });
});
