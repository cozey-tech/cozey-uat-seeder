import { z } from "zod";

export const seedWmsEntitiesRequestSchema = z.object({
  shopifyOrders: z.array(
    z.object({
      shopifyOrderId: z.string(),
      shopifyOrderNumber: z.string(),
      lineItems: z.array(
        z.object({
          lineItemId: z.string(),
          sku: z.string(),
        }),
      ),
    }),
  ),
  collectionPrepId: z.string().optional(),
  region: z.string(),
});

export type SeedWmsEntitiesRequest = z.infer<typeof seedWmsEntitiesRequestSchema>;
