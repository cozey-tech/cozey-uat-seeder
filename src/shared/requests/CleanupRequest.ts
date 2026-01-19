import { z } from "zod";

export const cleanupRequestSchema = z
  .object({
    batchId: z.string().uuid().optional(),
    collectionPrepName: z.string().optional(),
    tag: z.string().optional(),
    dryRun: z.boolean().default(false),
    skipConfirmation: z.boolean().default(false),
  })
  .refine((data) => data.batchId || data.collectionPrepName || data.tag, {
    message: "Must provide one of: batchId, collectionPrepName, or tag",
  });

export type CleanupRequest = z.infer<typeof cleanupRequestSchema> & {
  onProgress?: (current: number, total: number, entityType: string) => void;
};
