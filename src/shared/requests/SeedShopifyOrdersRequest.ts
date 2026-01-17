import { z } from "zod";

export const seedShopifyOrdersRequestSchema = z.object({
  orders: z.array(
    z.object({
      customer: z.object({
        name: z.string(),
        email: z.string().email(),
        address: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        postalCode: z.string().optional(),
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
  region: z.enum(["CA", "US"]).optional(), // Region for determining country code in shipping address
  collectionPrepName: z.string().optional(), // Collection prep name to include in order notes
});

export type SeedShopifyOrdersRequest = z.infer<typeof seedShopifyOrdersRequestSchema>;
