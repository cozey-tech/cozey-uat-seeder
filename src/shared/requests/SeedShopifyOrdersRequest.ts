import { z } from "zod";

export const seedShopifyOrdersRequestSchema = z.object({
  orders: z.array(
    z.object({
      customer: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
      lineItems: z.array(
        z.object({
          sku: z.string(),
          quantity: z.number().int().positive(),
        }),
      ),
    }),
  ),
  batchId: z.string().uuid(),
});

export type SeedShopifyOrdersRequest = z.infer<typeof seedShopifyOrdersRequestSchema>;
