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
  failures?: Array<{
    orderIndex: number;
    customerEmail: string;
    error: string;
  }>;
};
