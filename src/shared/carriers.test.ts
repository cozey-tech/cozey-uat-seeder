import { describe, expect, it } from "vitest";
import { carriers, Region } from "./carriers";

describe("carriers", () => {
  it("should load carriers from JSON config", () => {
    expect(carriers).toBeDefined();
    expect(Array.isArray(carriers)).toBe(true);
    expect(carriers.length).toBeGreaterThan(0);
  });

  it("should have valid carrier structure", () => {
    for (const carrier of carriers) {
      expect(carrier).toHaveProperty("code");
      expect(carrier).toHaveProperty("region");
      expect(carrier).toHaveProperty("name");
      expect(typeof carrier.code).toBe("string");
      expect(typeof carrier.name).toBe("string");
      expect(carrier.region === null || typeof carrier.region === "string").toBe(true);
    }
  });

  it("should have Region constants", () => {
    expect(Region.CA).toBe("CA");
    expect(Region.US).toBe("US");
  });

  it("should validate carriers with nearestWarehouses", () => {
    const carriersWithWarehouses = carriers.filter((c) => c.nearestWarehouses);

    for (const carrier of carriersWithWarehouses) {
      expect(Array.isArray(carrier.nearestWarehouses)).toBe(true);
      expect(carrier.nearestWarehouses).toBeDefined();

      for (const warehouse of carrier.nearestWarehouses!) {
        expect(warehouse).toHaveProperty("locationId");
        expect(warehouse).toHaveProperty("locationName");
        expect(typeof warehouse.locationId).toBe("string");
        expect(typeof warehouse.locationName).toBe("string");
      }
    }
  });

  it("should validate carriers with postalCodes", () => {
    const carriersWithPostalCodes = carriers.filter((c) => c.postalCodes);

    for (const carrier of carriersWithPostalCodes) {
      expect(Array.isArray(carrier.postalCodes)).toBe(true);
      expect(carrier.postalCodes).toBeDefined();

      for (const postalCode of carrier.postalCodes!) {
        expect(typeof postalCode).toBe("string");
      }
    }
  });

  it("should validate carriers with minimumBoxesQty", () => {
    const carriersWithMinBoxes = carriers.filter((c) => c.minimumBoxesQty !== undefined);

    for (const carrier of carriersWithMinBoxes) {
      expect(typeof carrier.minimumBoxesQty).toBe("number");
    }
  });
});
