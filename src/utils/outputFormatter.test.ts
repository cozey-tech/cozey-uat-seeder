import { describe, it, expect } from "vitest";
import { OutputFormatter } from "./outputFormatter";

describe("OutputFormatter", () => {
  describe("separator", () => {
    it("should create default separator", () => {
      const sep = OutputFormatter.separator();
      expect(sep).toHaveLength(50);
      expect(sep).toBe("━".repeat(50));
    });

    it("should create custom separator", () => {
      const sep = OutputFormatter.separator({ character: "-", length: 20 });
      expect(sep).toHaveLength(20);
      expect(sep).toBe("-".repeat(20));
    });
  });

  describe("header", () => {
    it("should format header without emoji", () => {
      const header = OutputFormatter.header("Test Header");
      expect(header).toBe("Test Header");
    });

    it("should format header with emoji", () => {
      const header = OutputFormatter.header("Test Header", "📦");
      expect(header).toBe("📦 Test Header");
    });
  });

  describe("success", () => {
    it("should format success message", () => {
      const msg = OutputFormatter.success("Operation completed");
      expect(msg).toBe("✅ Operation completed");
    });
  });

  describe("error", () => {
    it("should format error message", () => {
      const msg = OutputFormatter.error("Operation failed");
      expect(msg).toBe("❌ Operation failed");
    });
  });

  describe("warning", () => {
    it("should format warning message", () => {
      const msg = OutputFormatter.warning("This is a warning");
      expect(msg).toBe("⚠️  This is a warning");
    });
  });

  describe("info", () => {
    it("should format info message", () => {
      const msg = OutputFormatter.info("This is info");
      expect(msg).toBe("ℹ️  This is info");
    });
  });

  describe("progress", () => {
    it("should format progress message", () => {
      const msg = OutputFormatter.progress(5, 10, "Processing orders");
      expect(msg).toBe("Processing orders: 5/10 (50%)");
    });

    it("should format progress with details", () => {
      const msg = OutputFormatter.progress(3, 10, "Processing", "customer@example.com");
      expect(msg).toBe("Processing: 3/10 (30%) - customer@example.com");
    });
  });

  describe("step", () => {
    it("should format step indicator", () => {
      const msg = OutputFormatter.step(2, 5, "Seeding Shopify orders");
      expect(msg).toBe("Step 2/5: Seeding Shopify orders");
    });
  });

  describe("summary", () => {
    it("should format summary with items", () => {
      const summary = OutputFormatter.summary({
        title: "Summary",
        items: [
          { label: "Orders", value: 10 },
          { label: "Status", value: "Complete" },
        ],
      });

      expect(summary).toContain("Summary");
      expect(summary).toContain("Orders: 10");
      expect(summary).toContain("Status: Complete");
      expect(summary).toContain("━");
    });

    it("should format summary without trailing separator", () => {
      const summary = OutputFormatter.summary({
        title: "Summary",
        items: [{ label: "Test", value: "Value" }],
        showSeparator: false,
      });

      expect(summary).toContain("Summary");
      expect(summary).not.toMatch(/━\s*$/);
    });
  });

  describe("listItem", () => {
    it("should format list item with default indent", () => {
      const item = OutputFormatter.listItem("Item 1");
      expect(item).toBe("   - Item 1");
    });

    it("should format list item with custom indent", () => {
      const item = OutputFormatter.listItem("Item 1", 2);
      expect(item).toBe("      - Item 1");
    });
  });

  describe("keyValue", () => {
    it("should format key-value pair", () => {
      const kv = OutputFormatter.keyValue("Name", "Value");
      expect(kv).toBe("   Name: Value");
    });

    it("should format key-value with number", () => {
      const kv = OutputFormatter.keyValue("Count", 42);
      expect(kv).toBe("   Count: 42");
    });

    it("should format key-value with custom indent", () => {
      const kv = OutputFormatter.keyValue("Name", "Value", 2);
      expect(kv).toBe("      Name: Value");
    });
  });

  describe("section", () => {
    it("should format section with title and content", () => {
      const section = OutputFormatter.section("Title", ["Line 1", "Line 2"]);
      expect(section).toContain("Title");
      expect(section).toContain("Line 1");
      expect(section).toContain("Line 2");
      expect(section).toContain("━");
    });

    it("should format section with emoji", () => {
      const section = OutputFormatter.section("Title", ["Content"], "📦");
      expect(section).toContain("📦 Title");
    });
  });

  describe("count", () => {
    it("should format singular count", () => {
      const count = OutputFormatter.count(1, "order");
      expect(count).toBe("1 order");
    });

    it("should format plural count", () => {
      const count = OutputFormatter.count(5, "order");
      expect(count).toBe("5 orders");
    });

    it("should format zero count", () => {
      const count = OutputFormatter.count(0, "order");
      expect(count).toBe("0 orders");
    });
  });

  describe("duration", () => {
    it("should format milliseconds", () => {
      const duration = OutputFormatter.duration(500);
      expect(duration).toBe("500ms");
    });

    it("should format seconds", () => {
      const duration = OutputFormatter.duration(5000);
      expect(duration).toBe("5s");
    });

    it("should format minutes and seconds", () => {
      const duration = OutputFormatter.duration(125000);
      expect(duration).toBe("2m 5s");
    });

    it("should format minutes only", () => {
      const duration = OutputFormatter.duration(120000);
      expect(duration).toBe("2m");
    });

    it("should format hours and minutes", () => {
      const duration = OutputFormatter.duration(3665000);
      expect(duration).toBe("1h 1m");
    });
  });

  describe("percentage", () => {
    it("should format percentage with default decimals", () => {
      const pct = OutputFormatter.percentage(50);
      expect(pct).toBe("50%");
    });

    it("should format percentage with custom decimals", () => {
      const pct = OutputFormatter.percentage(50.5, 1);
      expect(pct).toBe("50.5%");
    });
  });
});
