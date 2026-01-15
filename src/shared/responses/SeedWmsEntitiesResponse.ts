export type SeedWmsEntitiesResponse = {
  orders: Array<{
    orderId: string;
    shopifyOrderId: string;
  }>;
  shipments: Array<{
    shipmentId: string;
    orderId: string;
  }>;
  prepPartItems: Array<{
    prepPartItemId: string;
    partId: string;
  }>;
};
