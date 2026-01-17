/**
 * GraphQL cost information from Shopify API response extensions
 */
export interface GraphQLCostInfo {
  requestedQueryCost: number;
  actualQueryCost: number;
  throttleStatus: {
    maximumAvailable: number;
    currentlyAvailable: number;
    restoreRate: number;
  };
}

/**
 * Performance metrics for a single operation
 */
export interface OperationMetrics {
  operation: string;
  durationMs: number;
  apiCallCount: number;
  graphQLCost?: GraphQLCostInfo;
}

/**
 * Performance metrics for a single order
 */
export interface OrderMetrics {
  orderIndex: number;
  customerEmail: string;
  variantLookup: OperationMetrics;
  draftOrderCreate: OperationMetrics;
  draftOrderComplete: OperationMetrics;
  orderQuery: OperationMetrics;
  totalDurationMs: number;
}

/**
 * Aggregate performance metrics for a batch
 */
export interface BatchPerformanceMetrics {
  totalOrders: number;
  totalDurationMs: number;
  totalApiCalls: number;
  totalGraphQLCost: {
    requested: number;
    actual: number;
  };
  averageOrderDurationMs: number;
  orderMetrics: OrderMetrics[];
  throttleStatus: {
    minimumAvailable: number;
    maximumAvailable: number;
    finalAvailable: number;
  };
}
