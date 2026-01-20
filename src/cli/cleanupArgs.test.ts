import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { parseCleanupArgs } from "./cleanupArgs";

describe("parseCleanupArgs", () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("should parse --batch-id argument", () => {
    process.argv = ["node", "cleanup.ts", "--batch-id", "abc-123-def-456"];

    const args = parseCleanupArgs();

    expect(args.batchId).toBe("abc-123-def-456");
    expect(args.dryRun).toBe(false);
    expect(args.skipConfirmation).toBe(false);
  });

  it("should parse --tag argument", () => {
    process.argv = ["node", "cleanup.ts", "--tag", "wms_seed"];

    const args = parseCleanupArgs();

    expect(args.tag).toBe("wms_seed");
    expect(args.dryRun).toBe(false);
  });

  it("should parse --dry-run flag", () => {
    process.argv = ["node", "cleanup.ts", "--batch-id", "abc-123", "--dry-run"];

    const args = parseCleanupArgs();

    expect(args.batchId).toBe("abc-123");
    expect(args.dryRun).toBe(true);
  });

  it("should parse --skip-confirmation flag", () => {
    process.argv = ["node", "cleanup.ts", "--batch-id", "abc-123", "--skip-confirmation"];

    const args = parseCleanupArgs();

    expect(args.batchId).toBe("abc-123");
    expect(args.skipConfirmation).toBe(true);
  });

  it("should parse multiple flags together", () => {
    process.argv = ["node", "cleanup.ts", "--batch-id", "abc-123", "--dry-run", "--skip-confirmation"];

    const args = parseCleanupArgs();

    expect(args.batchId).toBe("abc-123");
    expect(args.dryRun).toBe(true);
    expect(args.skipConfirmation).toBe(true);
  });

  it("should throw error if no identifier provided", () => {
    process.argv = ["node", "cleanup.ts", "--dry-run"];

    expect(() => parseCleanupArgs()).toThrow("Must specify one of");
  });

  it("should throw error for unknown argument", () => {
    process.argv = ["node", "cleanup.ts", "--batch-id", "abc-123", "--unknown"];

    expect(() => parseCleanupArgs()).toThrow("Unknown argument: --unknown");
  });
});
