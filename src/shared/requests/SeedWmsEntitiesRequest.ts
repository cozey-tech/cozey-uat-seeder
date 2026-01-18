import { z } from "zod";

export const seedWmsEntitiesRequestSchema = z.object({
  shopifyOrders: z.array(
    z.object({
      shopifyOrderId: z.string(),
      shopifyOrderNumber: z.string(),
      status: z.string().optional(), // Order status from Shopify
      customerName: z.string().optional(), // Customer name from Shopify
      customerEmail: z.string().email().optional(), // Customer email from Shopify
      lineItems: z.array(
        z.object({
          lineItemId: z.string(),
          sku: z.string(),
          quantity: z.number().int().positive().optional(), // Quantity from Shopify
        }),
      ),
    }),
  ),
  collectionPrepId: z.string().optional(),
  region: z.string(),
});

export type SeedWmsEntitiesRequest = z.infer<typeof seedWmsEntitiesRequestSchema> & {
  /**
   * Optional progress callback for order-by-order updates
   * Called when each order completes (success or failure)
   */
  onOrderProgress?: (current: number, total: number, shopifyOrderId: string, success: boolean) => void;
};
