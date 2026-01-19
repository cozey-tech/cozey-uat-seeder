export type CleanupResponse = {
  shopifyOrders: {
    deleted: string[];
    archived: string[];
    failed: Array<{ orderId: string; error: string }>;
  };
  wmsEntities: {
    orders: { deleted: number; failed: number };
    preps: { deleted: number; failed: number };
    shipments: { deleted: number; failed: number };
    collectionPreps: { deleted: number; failed: number };
  };
  summary: {
    totalDeleted: number;
    totalArchived: number;
    totalFailed: number;
    durationMs: number;
  };
};
