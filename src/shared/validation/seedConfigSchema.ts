import { z } from "zod";

const collectionPrepSchema = z.object({
  carrier: z.string(),
  locationId: z.string(),
  region: z.string(),
  prepDate: z.string().datetime(),
  testTag: z.string().optional(), // Optional test tag for collection prep naming
});

export const seedConfigSchema = z.object({
  region: z.enum(["CA", "US"]).optional(), // Region for all orders (required if collectionPreps is not present)
  collectionPreps: z.array(collectionPrepSchema).optional(), // Array of collection preps, each can have different carrier
  // Legacy support: keep collectionPrep for backward compatibility during migration
  collectionPrep: collectionPrepSchema.optional().describe("Deprecated: Use collectionPreps array instead"),
  orders: z.array(
    z.object({
      orderType: z.enum(["regular-only", "pnp-only", "mixed"]).optional(), // Flexible order configurations
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
