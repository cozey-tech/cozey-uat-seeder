export type SeedShopifyOrdersResponse = {
  shopifyOrders: Array<{
    shopifyOrderId: string;
    shopifyOrderNumber: string;
    lineItems: Array<{
      lineItemId: string;
      sku: string;
    }>;
    fulfillmentStatus: string;
  }>;
};
