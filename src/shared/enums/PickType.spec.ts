import { describe, expect, it } from "vitest";

import { PickType } from "./PickType";

describe("PickType", () => {
  it("should have correct enum values matching Prisma schema", () => {
    expect(PickType.Regular).toBe("Regular");
    expect(PickType.PickAndPack).toBe("Pick and Pack");
  });

  it("should use enum for comparison instead of string literals", () => {
    const pickType = PickType.PickAndPack;
    expect(pickType === PickType.PickAndPack).toBe(true);
  });
});
