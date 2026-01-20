import { z } from "zod";

const baseCleanupRequestSchema = z.object({
  batchId: z.string().uuid().optional(),
  tag: z.string().optional(),
  dryRun: z.boolean().default(false),
  skipConfirmation: z.boolean().default(false),
});

export const cleanupRequestSchema = baseCleanupRequestSchema.refine((data) => data.batchId || data.tag, {
  message: "Must provide one of: batchId or tag",
});

export type CleanupRequestBase = z.output<typeof cleanupRequestSchema>;

export type CleanupRequest = CleanupRequestBase & {
  onProgress?: (current: number, total: number, entityType: string) => void;
};
