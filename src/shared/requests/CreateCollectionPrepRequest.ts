import { z } from "zod";

export const createCollectionPrepRequestSchema = z.object({
  orderIds: z.array(z.string()).min(1),
  carrier: z.string(),
  locationId: z.string(),
  region: z.string(),
  prepDate: z.string().datetime(),
  testTag: z.string().optional(),
});

export type CreateCollectionPrepRequest = z.infer<typeof createCollectionPrepRequestSchema>;
