import { describe, expect, it } from "vitest";

import { OrderType } from "./OrderType";

describe("OrderType", () => {
  it("should have correct enum values", () => {
    expect(OrderType.RegularOnly).toBe("regular-only");
    expect(OrderType.PnpOnly).toBe("pnp-only");
    expect(OrderType.Mixed).toBe("mixed");
  });

  it("should use enum for comparison instead of string literals", () => {
    const orderType = OrderType.RegularOnly;
    expect(orderType === OrderType.RegularOnly).toBe(true);
    expect(orderType === "regular-only").toBe(true); // Type-safe comparison
  });
});
