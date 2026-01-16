import { z } from "zod";

export const seedConfigSchema = z.object({
  region: z.enum(["CA", "US"]).optional(), // Region for all orders (required if collectionPrep is not present)
  collectionPrep: z
    .object({
      carrier: z.string(),
      locationId: z.string(),
      region: z.string(),
      prepDate: z.string().datetime(),
    })
    .optional(), // Optional - seeder can create orders without collection prep
  orders: z.array(
    z.object({
      orderType: z.enum(["regular-only", "pnp-only", "mixed"]).optional(), // Flexible order configurations
      customer: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
      lineItems: z.array(
        z.object({
          sku: z.string(),
          quantity: z.number().int().positive(),
          pickType: z.enum(["Regular", "Pick and Pack"]),
          hasBarcode: z.boolean().optional(),
        }),
      ),
    }),
  ),
  pnpConfig: z
    .object({
      packageInfo: z.array(
        z.object({
          identifier: z.string(),
          dimensions: z.object({
            length: z.number(),
            width: z.number(),
            height: z.number(),
          }),
          weight: z.number(),
        }),
      ),
      boxes: z.array(
        z.object({
          identifier: z.string(),
          dimensions: z.object({
            length: z.number(),
            width: z.number(),
            height: z.number(),
          }),
        }),
      ),
    })
    .optional(),
});

export type SeedConfig = z.infer<typeof seedConfigSchema>;
