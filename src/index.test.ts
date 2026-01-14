import { describe, expect, it } from "vitest";

import { seedVersion } from "./index";

describe("seedVersion", () => {
  it("returns the current seed version string", () => {
    expect(seedVersion).toBe("0.1.0");
  });
});
