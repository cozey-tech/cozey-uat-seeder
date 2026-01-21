/**
 * Orchestration logic for seeding workflow
 */

// Suppress verbose logging during normal operations (show only warnings/errors)
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "warn";

import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import type { SeedConfig } from "../shared/types/SeedConfig";
import { InputParserService } from "../services/InputParserService";
import { DataValidationService } from "../services/DataValidationService";
import { ShopifyService } from "../services/ShopifyService";
import { WmsService } from "../services/WmsService";
import { CollectionPrepService } from "../services/CollectionPrepService";
import { WmsPrismaRepository } from "../repositories/prisma/WmsPrismaRepository";
import { SeedShopifyOrdersHandler } from "../business/seedShopifyOrders/SeedShopifyOrdersHandler";
import { SeedShopifyOrdersUseCase } from "../business/seedShopifyOrders/SeedShopifyOrdersUseCase";
import { SeedWmsEntitiesHandler } from "../business/seedWmsEntities/SeedWmsEntitiesHandler";
import { SeedWmsEntitiesUseCase } from "../business/seedWmsEntities/SeedWmsEntitiesUseCase";
import { CreateCollectionPrepHandler } from "../business/createCollectionPrep/CreateCollectionPrepHandler";
import { CreateCollectionPrepUseCase } from "../business/createCollectionPrep/CreateCollectionPrepUseCase";
import { OrderPollerService, WebhookTimeoutError } from "../services/OrderPollerService";
import { ProgressTracker } from "../utils/progress";
import { OutputFormatter } from "../utils/outputFormatter";
import { InteractivePromptService } from "../services/InteractivePromptService";
import { parseAndValidateConfig, validateData } from "./validation";
import { displaySummary } from "./output";
import { saveProgressState, deleteProgressState, type ProgressState } from "../utils/progressState";

/**
 * Service dependencies container
 */
export interface ServiceDependencies {
  prisma: PrismaClient;
  wmsRepository: WmsPrismaRepository;
  shopifyService: ShopifyService;
  wmsService: WmsService;
  collectionPrepService: CollectionPrepService;
  inputParser: InputParserService;
  dataValidator: DataValidationService;
  seedShopifyOrdersHandler: SeedShopifyOrdersHandler;
  seedWmsEntitiesHandler: SeedWmsEntitiesHandler;
  createCollectionPrepHandler: CreateCollectionPrepHandler;
  createCollectionPrepUseCase: CreateCollectionPrepUseCase;
}

/**
 * Initialize all services and handlers
 */
export function initializeServices(dryRun: boolean): ServiceDependencies {
  const prisma = new PrismaClient();
  const wmsRepository = new WmsPrismaRepository(prisma);
  const shopifyService = new ShopifyService(dryRun);
  const wmsService = new WmsService(wmsRepository, dryRun);
  const collectionPrepService = new CollectionPrepService(wmsRepository, dryRun);
  const inputParser = new InputParserService();
  const dataValidator = new DataValidationService(prisma);

  const seedShopifyOrdersUseCase = new SeedShopifyOrdersUseCase(shopifyService);
  const seedShopifyOrdersHandler = new SeedShopifyOrdersHandler(seedShopifyOrdersUseCase);

  const seedWmsEntitiesUseCase = new SeedWmsEntitiesUseCase(wmsService);
  const seedWmsEntitiesHandler = new SeedWmsEntitiesHandler(seedWmsEntitiesUseCase);

  const createCollectionPrepUseCase = new CreateCollectionPrepUseCase(collectionPrepService, prisma);
  const createCollectionPrepHandler = new CreateCollectionPrepHandler(createCollectionPrepUseCase);

  return {
    prisma,
    wmsRepository,
    shopifyService,
    wmsService,
    collectionPrepService,
    inputParser,
    dataValidator,
    seedShopifyOrdersHandler,
    seedWmsEntitiesHandler,
    createCollectionPrepHandler,
    createCollectionPrepUseCase,
  };
}

export interface ExecutionOptions {
  useWebhookMode: boolean;
  pollingTimeout: number; // seconds
  pollingInterval: number; // seconds
}

/**
 * Execute the seeding flow (shared between normal and dry-run)
 * Routes to webhook-based or direct mode based on options
 */
export async function executeSeedingFlow(
  config: SeedConfig,
  services: ServiceDependencies,
  batchId: string,
  isDryRun: boolean,
  options: ExecutionOptions,
  resumeState?: ProgressState,
): Promise<{
  shopifyResult: {
    shopifyOrders: Array<{
      shopifyOrderId: string;
      shopifyOrderNumber: string;
      lineItems: Array<{ lineItemId: string; sku: string }>;
    }>;
    failures?: Array<{ orderIndex: number; customerEmail: string; error: string }>;
  };
  wmsResult: {
    orders: Array<{ orderId: string }>;
    shipments: Array<{ shipmentId: string }>;
    failures?: Array<{ orderIndex: number; shopifyOrderId: string; customerEmail?: string; error: string }>;
  };
  collectionPrepResult?: { collectionPrepId: string; region: string };
}> {
  // Route to webhook or direct mode
  if (options.useWebhookMode && !isDryRun) {
    return executeWebhookBasedFlow(config, services, batchId, options, resumeState);
  } else {
    return executeDirectFlow(config, services, batchId, isDryRun, resumeState);
  }
}

/**
 * Execute seeding using direct Prisma mode (original behavior)
 * Creates WMS entities directly via Prisma, bypassing COS webhook
 */
async function executeDirectFlow(
  config: SeedConfig,
  services: ServiceDependencies,
  batchId: string,
  isDryRun: boolean,
  resumeState?: ProgressState,
): Promise<{
  shopifyResult: {
    shopifyOrders: Array<{
      shopifyOrderId: string;
      shopifyOrderNumber: string;
      lineItems: Array<{ lineItemId: string; sku: string }>;
    }>;
    failures?: Array<{ orderIndex: number; customerEmail: string; error: string }>;
  };
  wmsResult: {
    orders: Array<{ orderId: string }>;
    shipments: Array<{ shipmentId: string }>;
    failures?: Array<{ orderIndex: number; shopifyOrderId: string; customerEmail?: string; error: string }>;
  };
  collectionPrepResult?: { collectionPrepId: string; region: string };
}> {
  // Generate collection prep name early if collection prep is configured
  // This allows us to include it in Shopify order notes
  let collectionPrepName: string | undefined;
  if (config.collectionPrep) {
    collectionPrepName = await services.createCollectionPrepUseCase.generateCollectionPrepName(
      config.collectionPrep.testTag,
      config.collectionPrep.carrier,
      config.collectionPrep.locationId,
      config.collectionPrep.region,
    );
  }

  const step1Label = isDryRun ? "Would seed" : resumeState ? "Resuming" : "Seeding";
  const step1Name = `${step1Label} Shopify orders`;
  const totalSteps = config.collectionPrep ? 3 : 2;
  console.log(OutputFormatter.step(1, totalSteps, step1Name));

  let ordersToProcess = config.orders;
  const filteredToOriginalIndexMap = new Map<number, number>();
  if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
    const successfulIndices = new Set(resumeState.shopifyOrders.successful.map((s) => s.orderIndex));
    ordersToProcess = config.orders.filter((_, index) => !successfulIndices.has(index));
    let filteredIndex = 0;
    for (let originalIndex = 0; originalIndex < config.orders.length; originalIndex++) {
      if (!successfulIndices.has(originalIndex)) {
        filteredToOriginalIndexMap.set(filteredIndex, originalIndex);
        filteredIndex++;
      }
    }
    console.log(
      OutputFormatter.info(
        `Resuming: ${ordersToProcess.length} failed orders to retry, ${resumeState.shopifyOrders.successful.length} already successful`,
      ),
    );
  } else {
    for (let i = 0; i < config.orders.length; i++) {
      filteredToOriginalIndexMap.set(i, i);
    }
  }

  const progressTracker = new ProgressTracker();
  const totalOrders = config.orders.length;
  progressTracker.start(step1Name, totalOrders);

  if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
    progressTracker.update(resumeState.shopifyOrders.successful.length, "Already completed");
  }

  const shopifyRequest = {
    orders: ordersToProcess.map((order) => ({
      customer: order.customer,
      lineItems: order.lineItems.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
      })),
    })),
    batchId,
    region: config.region || config.collectionPrep?.region || "CA",
    testTag: config.collectionPrep?.testTag,
    onOrderProgress: (current: number, total: number, customerEmail: string, _success: boolean): void => {
      // Adjust current count if resuming (add already completed count)
      // Note: 'current' and 'total' are relative to ordersToProcess, not config.orders
      // When resuming, 'current' represents progress through only the orders being retried,
      // so we add the count of previously successful orders to get the total progress.
      const adjustedCurrent = resumeState ? resumeState.shopifyOrders.successful.length + current : current;
      progressTracker.update(adjustedCurrent, customerEmail);
    },
  };

  const shopifyResult = await services.seedShopifyOrdersHandler.execute(shopifyRequest);

  let finalShopifyResult = shopifyResult;
  if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
    // Note: Line items not stored in progress state for previous orders
    const previousSuccessful = resumeState.shopifyOrders.successful.map((s) => ({
      shopifyOrderId: s.shopifyOrderId,
      shopifyOrderNumber: s.shopifyOrderNumber,
      lineItems: [] as Array<{ lineItemId: string; sku: string }>,
      fulfillmentStatus: "unfulfilled" as string,
    }));
    finalShopifyResult = {
      shopifyOrders: [...previousSuccessful, ...shopifyResult.shopifyOrders],
      failures: shopifyResult.failures,
    };
  }

  progressTracker.update(config.orders.length);
  progressTracker.complete();

  const createdLabel = isDryRun ? "Would create" : resumeState ? "Resumed" : "Created";
  const successCount = finalShopifyResult.shopifyOrders.length;
  const totalCount = config.orders.length;

  if (finalShopifyResult.failures && finalShopifyResult.failures.length > 0) {
    console.log(
      OutputFormatter.warning(
        `${createdLabel} ${successCount}/${totalCount} Shopify order(s). ${finalShopifyResult.failures.length} failed.\n`,
      ),
    );
  } else {
    console.log(OutputFormatter.success(`${createdLabel} ${successCount} Shopify order(s)\n`));
  }

  if (!isDryRun) {
    const successfulOrders: Array<{
      orderIndex: number;
      shopifyOrderId: string;
      shopifyOrderNumber: string;
      customerEmail: string;
    }> = [];

    if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
      successfulOrders.push(...resumeState.shopifyOrders.successful);
    }

    // Map filtered indices back to original config.orders indices
    const failedIndices = new Set((shopifyResult.failures || []).map((f) => f.orderIndex));

    const successfulOrderIdToProcessedIndex = new Map<string, number>();
    let successfulOrderIndex = 0;
    for (let processedIndex = 0; processedIndex < ordersToProcess.length; processedIndex++) {
      if (!failedIndices.has(processedIndex)) {
        if (successfulOrderIndex < shopifyResult.shopifyOrders.length) {
          const successfulOrder = shopifyResult.shopifyOrders[successfulOrderIndex];
          successfulOrderIdToProcessedIndex.set(successfulOrder.shopifyOrderId, processedIndex);
          successfulOrderIndex++;
        }
      }
    }

    // Map successful orders using their position in ordersToProcess
    for (const order of shopifyResult.shopifyOrders) {
      const processedIndex = successfulOrderIdToProcessedIndex.get(order.shopifyOrderId);
      if (processedIndex !== undefined) {
        const originalIndex = filteredToOriginalIndexMap.get(processedIndex);
        if (originalIndex !== undefined) {
          const customerEmail = config.orders[originalIndex]?.customer.email || "";
          successfulOrders.push({
            orderIndex: originalIndex,
            shopifyOrderId: order.shopifyOrderId,
            shopifyOrderNumber: order.shopifyOrderNumber,
            customerEmail,
          });
        }
      }
    }

    // Map failures: convert filtered indices to original indices
    const failedOrders = (shopifyResult.failures || []).map((failure) => {
      const originalIndex = filteredToOriginalIndexMap.get(failure.orderIndex);
      return {
        orderIndex: originalIndex !== undefined ? originalIndex : failure.orderIndex,
        customerEmail: failure.customerEmail,
        error: failure.error,
      };
    });

    const progressState: ProgressState = {
      batchId,
      timestamp: Date.now(),
      shopifyOrders: {
        successful: successfulOrders,
        failed: failedOrders,
      },
      wmsEntities: resumeState?.wmsEntities || {
        successful: [],
        failed: [],
        shipments: [],
      },
    };
    saveProgressState(progressState);
  }

  if (finalShopifyResult.failures && finalShopifyResult.failures.length > 0) {
    console.log(
      OutputFormatter.section("Shopify Seeding Failures", [
        OutputFormatter.listItem(`Failed: ${finalShopifyResult.failures.length} of ${totalCount} orders`),
        ...finalShopifyResult.failures.map((failure) =>
          OutputFormatter.listItem(`Order ${failure.orderIndex + 1} (${failure.customerEmail}): ${failure.error}`, 2),
        ),
      ]),
    );

    console.log(OutputFormatter.info(`To resume this operation, use: --resume ${batchId}`));
    console.log();

    const promptService = new InteractivePromptService();
    const shouldContinue = await promptService.promptConfirm(
      "Some Shopify orders failed. Continue with WMS seeding for successful orders?",
      false,
    );

    if (!shouldContinue) {
      console.log(OutputFormatter.info("Aborting seeding operation."));
      process.exit(1);
    }
    console.log();
  }

  const step2Number = config.collectionPrep ? 3 : 2;
  const step2Name = `${step1Label} WMS entities`;
  console.log(OutputFormatter.step(step2Number, config.collectionPrep ? 3 : 2, step2Name));

  const region = config.collectionPrep?.region || "CA";
  let collectionPrepId: string | undefined;

  if (config.collectionPrep) {
    const step2aNumber = 2;
    const creatingLabel = isDryRun ? "Would create" : "Creating";
    console.log(OutputFormatter.step(step2aNumber, totalSteps, `${creatingLabel} collection prep`));
    const collectionPrepRequest = {
      orderIds: finalShopifyResult.shopifyOrders.map((o) => o.shopifyOrderId),
      carrier: config.collectionPrep.carrier,
      locationId: config.collectionPrep.locationId,
      region: config.collectionPrep.region,
      prepDate: config.collectionPrep.prepDate,
      testTag: config.collectionPrep.testTag,
      collectionPrepName, // Use pre-generated name
    };

    const collectionPrepResult = await services.createCollectionPrepHandler.execute(collectionPrepRequest);
    collectionPrepId = collectionPrepResult.collectionPrepId;
    console.log(OutputFormatter.success(`${createdLabel} collection prep: ${collectionPrepId}\n`));
  }

  // Seed WMS entities with Shopify order data
  const wmsProgressTracker = new ProgressTracker();
  wmsProgressTracker.start(step2Name, finalShopifyResult.shopifyOrders.length);

  // Filter WMS orders if resuming (skip already successful ones)
  // Also create a mapping from filtered array index to original config.orders index
  let wmsOrdersToProcess = finalShopifyResult.shopifyOrders;
  const wmsFilteredToOriginalIndexMap = new Map<number, number>(); // Maps filtered array index -> original config.orders index
  if (resumeState && resumeState.wmsEntities.successful.length > 0) {
    const successfulShopifyIds = new Set(resumeState.wmsEntities.successful.map((s) => s.shopifyOrderId));
    wmsOrdersToProcess = finalShopifyResult.shopifyOrders.filter(
      (order) => !successfulShopifyIds.has(order.shopifyOrderId),
    );
    // Map each filtered order position to original index by looking up shopifyOrderId
    let filteredIndex = 0;
    for (const wmsOrder of finalShopifyResult.shopifyOrders) {
      if (!successfulShopifyIds.has(wmsOrder.shopifyOrderId)) {
        const prevSuccess = resumeState.shopifyOrders.successful.find(
          (s) => s.shopifyOrderId === wmsOrder.shopifyOrderId,
        );
        if (prevSuccess) {
          wmsFilteredToOriginalIndexMap.set(filteredIndex, prevSuccess.orderIndex);
        } else {
          const shopifyIndex = shopifyResult.shopifyOrders.findIndex(
            (shopifyOrder) => shopifyOrder.shopifyOrderId === wmsOrder.shopifyOrderId,
          );
          if (shopifyIndex !== -1) {
            const mappedOriginalIndex = filteredToOriginalIndexMap.get(shopifyIndex);
            if (mappedOriginalIndex !== undefined) {
              wmsFilteredToOriginalIndexMap.set(filteredIndex, mappedOriginalIndex);
            }
          }
        }
        filteredIndex++;
      }
    }
    console.log(
      OutputFormatter.info(
        `Resuming WMS: ${wmsOrdersToProcess.length} orders to retry, ${resumeState.wmsEntities.successful.length} already successful`,
      ),
    );
  } else {
    for (let i = 0; i < finalShopifyResult.shopifyOrders.length; i++) {
      wmsFilteredToOriginalIndexMap.set(i, i < config.orders.length ? i : i);
    }
  }

  const wmsRequest = {
    shopifyOrders: wmsOrdersToProcess.map((shopifyOrder, filteredIndex) => {
      let configOrder = config.orders[0];

      if (resumeState) {
        const prevSuccess = resumeState.shopifyOrders.successful.find(
          (s) => s.shopifyOrderId === shopifyOrder.shopifyOrderId,
        );
        if (prevSuccess) {
          configOrder = config.orders[prevSuccess.orderIndex];
        } else {
          const originalIndex = wmsFilteredToOriginalIndexMap.get(filteredIndex);
          if (originalIndex !== undefined && originalIndex < config.orders.length) {
            configOrder = config.orders[originalIndex];
          }
        }
      } else {
        const originalIndex = wmsFilteredToOriginalIndexMap.get(filteredIndex);
        if (originalIndex !== undefined && originalIndex < config.orders.length) {
          configOrder = config.orders[originalIndex];
        }
      }
      const lineItemsWithQuantity =
        shopifyOrder.lineItems.length > 0
          ? shopifyOrder.lineItems.map((shopifyItem) => {
              const configItem = configOrder.lineItems.find((item) => item.sku === shopifyItem.sku);
              return {
                lineItemId: shopifyItem.lineItemId,
                sku: shopifyItem.sku,
                quantity: configItem?.quantity || 1,
              };
            })
          : configOrder.lineItems.map((item) => ({
              lineItemId: `resumed-${item.sku}`,
              sku: item.sku,
              quantity: item.quantity,
            }));

      return {
        shopifyOrderId: shopifyOrder.shopifyOrderId,
        shopifyOrderNumber: shopifyOrder.shopifyOrderNumber,
        status: "paid",
        customerName: configOrder.customer.name,
        customerEmail: configOrder.customer.email,
        lineItems: lineItemsWithQuantity,
      };
    }),
    collectionPrepId,
    region,
    onOrderProgress: (current: number, total: number, shopifyOrderId: string, _success: boolean): void => {
      // Adjust current count if resuming (add already completed count)
      // Note: 'current' and 'total' are relative to wmsOrdersToProcess, not finalShopifyResult
      // When resuming, 'current' represents progress through only the orders being retried,
      // so we add the count of previously successful orders to get the total progress.
      const adjustedCurrent = resumeState ? resumeState.wmsEntities.successful.length + current : current;
      wmsProgressTracker.update(adjustedCurrent, shopifyOrderId);
    },
  };

  const wmsResult = await services.seedWmsEntitiesHandler.execute(wmsRequest);

  // Merge results if resuming
  let finalWmsResult = wmsResult;
  if (resumeState && resumeState.wmsEntities.successful.length > 0) {
    // Merge successful orders from previous run with new results
    const previousSuccessful = resumeState.wmsEntities.successful.map((s) => ({
      orderId: s.orderId,
      shopifyOrderId: s.shopifyOrderId,
    }));
    // Merge prepPartItems from previous successful run with new ones
    const previousPrepPartItems = resumeState.wmsEntities.successful.flatMap((s) => s.prepPartItems);
    // Merge shipments from previous run with new ones
    const previousShipments = resumeState.wmsEntities.shipments || [];
    finalWmsResult = {
      orders: [...previousSuccessful, ...wmsResult.orders],
      shipments: [...previousShipments, ...wmsResult.shipments], // Merge previous and new shipments
      prepPartItems: [...previousPrepPartItems, ...wmsResult.prepPartItems],
      failures: wmsResult.failures,
    };
  }

  // Track prepPartItems per order for progress state
  // Since prepPartItems are created sequentially per order in the use case,
  // we need to map them back to orders. For resumed orders, we have them stored.
  // For new orders, we need to track them as they're created.
  // Note: This is a limitation - we don't have exact mapping without modifying the use case.
  // For now, we'll store prepPartItems from resumed orders and track new ones by order index.
  const prepPartItemsByOrder = new Map<string, Array<{ prepPartItemId: string; partId: string }>>();

  // Add prepPartItems from resumed orders (they're already stored per order)
  if (resumeState) {
    for (const resumedOrder of resumeState.wmsEntities.successful) {
      prepPartItemsByOrder.set(resumedOrder.shopifyOrderId, resumedOrder.prepPartItems);
    }
  }

  // Map prepPartItems to orders using order index in wmsOrdersToProcess
  // Note: prepPartItems are created sequentially; wmsResult.orders only contains successful orders
  const wmsFailedIndicesForPrepMapping = new Set((wmsResult.failures || []).map((f) => f.orderIndex));
  let prepPartItemOffset = 0;
  let successfulOrderIndex = 0;
  for (let processedIndex = 0; processedIndex < wmsOrdersToProcess.length; processedIndex++) {
    if (!wmsFailedIndicesForPrepMapping.has(processedIndex)) {
      // This order succeeded
      if (successfulOrderIndex < wmsResult.orders.length) {
        const order = wmsResult.orders[successfulOrderIndex];
        const shopifyOrder = wmsOrdersToProcess[processedIndex];
        if (shopifyOrder) {
          // Estimate prepPartItems: roughly one per line item (simplified)
          // In reality, prepPartItems depend on parts per variant, but this is a reasonable approximation
          const estimatedItemsPerOrder = shopifyOrder.lineItems.length;
          const orderPrepPartItems = wmsResult.prepPartItems.slice(
            prepPartItemOffset,
            prepPartItemOffset + estimatedItemsPerOrder,
          );
          prepPartItemOffset += estimatedItemsPerOrder;
          prepPartItemsByOrder.set(order.shopifyOrderId, orderPrepPartItems);
        }
        successfulOrderIndex++;
      }
    }
  }

  wmsProgressTracker.update(finalShopifyResult.shopifyOrders.length);
  wmsProgressTracker.complete();

  const wmsSuccessCount = finalWmsResult.orders.length;
  const wmsTotalCount = finalShopifyResult.shopifyOrders.length;

  if (finalWmsResult.failures && finalWmsResult.failures.length > 0) {
    console.log(
      OutputFormatter.warning(
        `${createdLabel} ${wmsSuccessCount}/${wmsTotalCount} WMS order(s). ${finalWmsResult.failures.length} failed.`,
      ),
    );
    console.log(OutputFormatter.warning(`${createdLabel} ${finalWmsResult.shipments.length} shipment(s)\n`));
  } else {
    console.log(OutputFormatter.success(`${createdLabel} ${wmsSuccessCount} WMS order(s)`));
    console.log(OutputFormatter.success(`${createdLabel} ${finalWmsResult.shipments.length} shipment(s)\n`));
  }

  // Save progress state after WMS seeding
  if (!isDryRun) {
    const progressState: ProgressState = {
      batchId,
      timestamp: Date.now(),
      shopifyOrders: {
        // Reuse the same logic we used when saving after Shopify seeding
        // Build successful orders array with correct orderIndex values
        successful: ((): Array<{
          orderIndex: number;
          shopifyOrderId: string;
          shopifyOrderNumber: string;
          customerEmail: string;
        }> => {
          const successful: Array<{
            orderIndex: number;
            shopifyOrderId: string;
            shopifyOrderNumber: string;
            customerEmail: string;
          }> = [];

          // Add previously successful orders (they already have correct orderIndex from resumeState)
          if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
            successful.push(...resumeState.shopifyOrders.successful);
          }

          // Add newly successful orders from current run, mapping their filtered indices back to original indices
          // Note: shopifyResult contains only newly processed orders (not merged with previous)
          for (const order of shopifyResult.shopifyOrders) {
            const filteredIndex = shopifyResult.shopifyOrders.findIndex(
              (o) => o.shopifyOrderId === order.shopifyOrderId,
            );
            if (filteredIndex !== -1) {
              const originalIndex = filteredToOriginalIndexMap.get(filteredIndex);
              if (originalIndex !== undefined) {
                const customerEmail = config.orders[originalIndex]?.customer.email || "";
                successful.push({
                  orderIndex: originalIndex,
                  shopifyOrderId: order.shopifyOrderId,
                  shopifyOrderNumber: order.shopifyOrderNumber,
                  customerEmail,
                });
              }
            }
          }

          return successful;
        })(),
        failed: (shopifyResult.failures || []).map((failure) => {
          const originalIndex = filteredToOriginalIndexMap.get(failure.orderIndex);
          return {
            orderIndex: originalIndex !== undefined ? originalIndex : failure.orderIndex,
            customerEmail: failure.customerEmail,
            error: failure.error,
          };
        }),
      },
      wmsEntities: {
        successful: ((): Array<{
          orderIndex: number;
          orderId: string;
          shopifyOrderId: string;
          prepPartItems: Array<{ prepPartItemId: string; partId: string }>;
        }> => {
          const successful: Array<{
            orderIndex: number;
            orderId: string;
            shopifyOrderId: string;
            prepPartItems: Array<{ prepPartItemId: string; partId: string }>;
          }> = [];

          // Add previously successful orders (they already have correct orderIndex from resumeState)
          if (resumeState && resumeState.wmsEntities.successful.length > 0) {
            successful.push(...resumeState.wmsEntities.successful);
          }

          // Add newly successful orders from current run, mapping their filtered indices back to original indices
          // Note: wmsResult.orders only contains successful orders, so we need to reconstruct the mapping
          // by tracking which orders from wmsOrdersToProcess succeeded vs failed.

          // Build set of failed indices (relative to wmsOrdersToProcess)
          const wmsFailedIndices = new Set((wmsResult.failures || []).map((f) => f.orderIndex));

          // Build map of shopifyOrderId to index in wmsOrdersToProcess
          // Since orders are processed sequentially, we can match successful orders by position
          const successfulOrderIdToProcessedIndex = new Map<string, number>();
          let successfulOrderIndex = 0;
          for (let processedIndex = 0; processedIndex < wmsOrdersToProcess.length; processedIndex++) {
            if (!wmsFailedIndices.has(processedIndex)) {
              // This order succeeded - match it to the successful order at this position
              if (successfulOrderIndex < wmsResult.orders.length) {
                const successfulOrder = wmsResult.orders[successfulOrderIndex];
                successfulOrderIdToProcessedIndex.set(successfulOrder.shopifyOrderId, processedIndex);
                successfulOrderIndex++;
              }
            }
          }

          // Map successful orders using their position in wmsOrdersToProcess
          for (const order of wmsResult.orders) {
            const processedIndex = successfulOrderIdToProcessedIndex.get(order.shopifyOrderId);
            if (processedIndex !== undefined) {
              const originalIndex = wmsFilteredToOriginalIndexMap.get(processedIndex);
              if (originalIndex !== undefined) {
                // Get prepPartItems for this order from our tracking map
                const prepPartItemsForOrder = prepPartItemsByOrder.get(order.shopifyOrderId) || [];
                successful.push({
                  orderIndex: originalIndex,
                  orderId: order.orderId,
                  shopifyOrderId: order.shopifyOrderId,
                  prepPartItems: prepPartItemsForOrder,
                });
              }
            }
          }

          return successful;
        })(),
        failed: (wmsResult.failures || []).map((failure) => {
          // Map failure orderIndex from filtered to original
          const originalIndex = wmsFilteredToOriginalIndexMap.get(failure.orderIndex);
          return {
            orderIndex: originalIndex !== undefined ? originalIndex : failure.orderIndex,
            shopifyOrderId: failure.shopifyOrderId,
            customerEmail: failure.customerEmail,
            error: failure.error,
          };
        }),
        shipments: finalWmsResult.shipments, // Store all shipments (previous + new) for resume
      },
      collectionPrep: collectionPrepId ? { collectionPrepId, region: config.collectionPrep!.region } : undefined,
    };
    saveProgressState(progressState);
  }

  // Handle partial failures from WMS seeding
  if (finalWmsResult.failures && finalWmsResult.failures.length > 0) {
    console.log(
      OutputFormatter.section("WMS Seeding Failures", [
        OutputFormatter.listItem(`Failed: ${finalWmsResult.failures.length} of ${wmsTotalCount} orders`),
        ...finalWmsResult.failures.map((failure) =>
          OutputFormatter.listItem(
            `Order ${failure.orderIndex + 1} (${failure.shopifyOrderId}${failure.customerEmail ? `, ${failure.customerEmail}` : ""}): ${failure.error}`,
            2,
          ),
        ),
      ]),
    );
    console.log(OutputFormatter.info(`To resume this operation, use: --resume ${batchId}`));
    console.log();
  }

  const collectionPrepResult = collectionPrepId
    ? { collectionPrepId, region: config.collectionPrep!.region }
    : undefined;

  // Delete progress state on successful completion
  if (
    !isDryRun &&
    (!finalShopifyResult.failures || finalShopifyResult.failures.length === 0) &&
    (!finalWmsResult.failures || finalWmsResult.failures.length === 0)
  ) {
    deleteProgressState(batchId);
  }

  return { shopifyResult: finalShopifyResult, wmsResult: finalWmsResult, collectionPrepResult };
}

/**
 * Execute seeding using webhook-based mode (production-like behavior)
 * Creates Shopify orders, waits for COS webhook to ingest them, then creates collection prep
 */
async function executeWebhookBasedFlow(
  config: SeedConfig,
  services: ServiceDependencies,
  batchId: string,
  options: ExecutionOptions,
  resumeState?: ProgressState,
): Promise<{
  shopifyResult: {
    shopifyOrders: Array<{
      shopifyOrderId: string;
      shopifyOrderNumber: string;
      lineItems: Array<{ lineItemId: string; sku: string }>;
    }>;
    failures?: Array<{ orderIndex: number; customerEmail: string; error: string }>;
  };
  wmsResult: {
    orders: Array<{ orderId: string }>;
    shipments: Array<{ shipmentId: string }>;
    failures?: Array<{ orderIndex: number; shopifyOrderId: string; customerEmail?: string; error: string }>;
  };
  collectionPrepResult?: { collectionPrepId: string; region: string };
}> {
  console.log(OutputFormatter.info("Running in WEBHOOK MODE (production-like behavior)"));
  console.log(OutputFormatter.info("COS webhook will create WMS entities automatically\n"));

  // Step 1: Create Shopify orders (same as direct mode)
  let collectionPrepName: string | undefined;
  if (config.collectionPrep) {
    collectionPrepName = await services.createCollectionPrepUseCase.generateCollectionPrepName(
      config.collectionPrep.testTag,
      config.collectionPrep.carrier,
      config.collectionPrep.locationId,
      config.collectionPrep.region,
    );
  }

  const step1Label = resumeState ? "Resuming" : "Seeding";
  const totalSteps = config.collectionPrep ? 3 : 2;
  console.log(OutputFormatter.step(1, totalSteps, `${step1Label} Shopify orders`));

  let ordersToProcess = config.orders;
  const filteredToOriginalIndexMap = new Map<number, number>();
  if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
    const successfulIndices = new Set(resumeState.shopifyOrders.successful.map((s) => s.orderIndex));
    ordersToProcess = config.orders.filter((_, index) => !successfulIndices.has(index));
    let filteredIndex = 0;
    for (let originalIndex = 0; originalIndex < config.orders.length; originalIndex++) {
      if (!successfulIndices.has(originalIndex)) {
        filteredToOriginalIndexMap.set(filteredIndex, originalIndex);
        filteredIndex++;
      }
    }
    console.log(
      OutputFormatter.info(
        `Resuming: ${ordersToProcess.length} failed orders to retry, ${resumeState.shopifyOrders.successful.length} already successful`,
      ),
    );
  } else {
    for (let i = 0; i < config.orders.length; i++) {
      filteredToOriginalIndexMap.set(i, i);
    }
  }

  const progressTracker = new ProgressTracker();
  progressTracker.start(`${step1Label} Shopify orders`, config.orders.length);

  if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
    progressTracker.update(resumeState.shopifyOrders.successful.length, "Already completed");
  }

  const shopifyRequest = {
    orders: ordersToProcess.map((order) => ({
      customer: order.customer,
      lineItems: order.lineItems.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
      })),
    })),
    batchId,
    region: config.region || config.collectionPrep?.region || "CA",
    testTag: config.collectionPrep?.testTag,
    onOrderProgress: (current: number, _total: number, customerEmail: string, _success: boolean): void => {
      const adjustedCurrent = resumeState ? resumeState.shopifyOrders.successful.length + current : current;
      progressTracker.update(adjustedCurrent, customerEmail);
    },
  };

  const shopifyResult = await services.seedShopifyOrdersHandler.execute(shopifyRequest);

  let finalShopifyResult = shopifyResult;
  if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
    const previousSuccessful = resumeState.shopifyOrders.successful.map((s) => ({
      shopifyOrderId: s.shopifyOrderId,
      shopifyOrderNumber: s.shopifyOrderNumber,
      lineItems: [] as Array<{ lineItemId: string; sku: string }>,
      fulfillmentStatus: "unfulfilled" as string,
    }));
    finalShopifyResult = {
      shopifyOrders: [...previousSuccessful, ...shopifyResult.shopifyOrders],
      failures: shopifyResult.failures,
    };
  }

  progressTracker.update(config.orders.length);
  progressTracker.complete();

  const createdLabel = resumeState ? "Resumed" : "Created";
  const successCount = finalShopifyResult.shopifyOrders.length;
  const totalCount = config.orders.length;

  if (finalShopifyResult.failures && finalShopifyResult.failures.length > 0) {
    console.log(
      OutputFormatter.warning(
        `${createdLabel} ${successCount}/${totalCount} Shopify order(s). ${finalShopifyResult.failures.length} failed.\n`,
      ),
    );
  } else {
    console.log(OutputFormatter.success(`${createdLabel} ${successCount} Shopify order(s)\n`));
  }

  // Handle failures - allow user to continue or abort
  if (finalShopifyResult.failures && finalShopifyResult.failures.length > 0) {
    console.log(
      OutputFormatter.section("Shopify Seeding Failures", [
        OutputFormatter.listItem(`Failed: ${finalShopifyResult.failures.length} of ${totalCount} orders`),
        ...finalShopifyResult.failures.map((failure) =>
          OutputFormatter.listItem(`Order ${failure.orderIndex + 1} (${failure.customerEmail}): ${failure.error}`, 2),
        ),
      ]),
    );

    console.log(OutputFormatter.info(`To resume this operation, use: --resume ${batchId}`));
    console.log();

    const promptService = new InteractivePromptService();
    const shouldContinue = await promptService.promptConfirm(
      "Some Shopify orders failed. Continue waiting for COS webhook for successful orders?",
      false,
    );

    if (!shouldContinue) {
      console.log(OutputFormatter.info("Aborting seeding operation."));
      process.exit(1);
    }
    console.log();
  }

  // Step 2: Wait for COS webhook to ingest orders
  console.log(OutputFormatter.step(2, totalSteps, "Waiting for COS webhook ingestion"));
  console.log(OutputFormatter.info("COS will create: order, prep, prepPart, customer, variantOrder"));
  console.log(OutputFormatter.info("COS will update: inventory, inventoryHistory\n"));

  const pollerService = new OrderPollerService(services.wmsRepository);

  // Use custom progress display for polling (ProgressTracker doesn't handle 0-based well)
  let lastProgressMessage = "";
  const pollStartTime = Date.now();

  console.log("⏳ Polling for COS webhook ingestion...");

  let pollingResult;
  try {
    pollingResult = await pollerService.pollForOrders(
      finalShopifyResult.shopifyOrders.map((o) => o.shopifyOrderId),
      {
        timeout: options.pollingTimeout * 1000, // Convert seconds to milliseconds
        pollInterval: options.pollingInterval * 1000,
        onProgress: (found: number, total: number, elapsed: number) => {
          const elapsedSec = Math.round(elapsed / 1000);
          const message =
            found > 0
              ? `   Found ${found}/${total} orders (${elapsedSec}s elapsed)`
              : `   Waiting for COS webhook... (${elapsedSec}s elapsed)`;

          // Clear previous line and write new progress
          if (lastProgressMessage) {
            process.stdout.write("\r\x1b[K"); // Clear line
          }
          process.stdout.write(message);
          lastProgressMessage = message;
        },
        allowPartialSuccess: false, // Strict mode: fail if any order times out
      },
    );

    // Clear progress line and show success
    if (lastProgressMessage) {
      process.stdout.write("\r\x1b[K"); // Clear line
    }

    const totalElapsed = Math.round((Date.now() - pollStartTime) / 1000);
    const prepCount = pollingResult.foundOrders.reduce((sum, o) => sum + o.preps.length, 0);
    console.log(
      OutputFormatter.success(
        `✅ All ${pollingResult.foundOrders.length} orders ingested by COS webhook in ${totalElapsed}s (${prepCount} preps created)\n`,
      ),
    );
  } catch (error) {
    // Clear progress line on error
    if (lastProgressMessage) {
      process.stdout.write("\r\x1b[K\n");
    }

    if (error instanceof WebhookTimeoutError) {
      console.log(OutputFormatter.error("\n⚠️  COS webhook timeout\n"));
      console.log(OutputFormatter.info(`Batch ID: ${batchId}`));
      console.log(OutputFormatter.info(`To resume: npm run seed config.json --resume ${batchId}\n`));
      console.log(
        OutputFormatter.section("Suggestions", [
          OutputFormatter.listItem("Wait a few minutes and check WMS database manually"),
          OutputFormatter.listItem("Retry with longer timeout: --polling-timeout 600 (10 minutes)"),
          OutputFormatter.listItem("Use direct mode as fallback: --use-direct-mode"),
          OutputFormatter.listItem("Check COS webhook listener status"),
        ]),
      );
      throw error;
    }
    throw error;
  }

  // Step 3: Create collection prep (if configured)
  let collectionPrepId: string | undefined;
  if (config.collectionPrep) {
    console.log(OutputFormatter.step(3, totalSteps, "Creating collection prep"));

    // Extract prep IDs from polling result
    const allPrepIds = pollingResult.foundOrders.flatMap((order) => order.preps.map((p) => p.prepId));

    console.log(OutputFormatter.info(`Using ${allPrepIds.length} preps created by COS webhook\n`));

    const collectionPrepRequest = {
      orderIds: pollingResult.foundOrders.map((o) => o.shopifyOrderId),
      carrier: config.collectionPrep.carrier,
      locationId: config.collectionPrep.locationId,
      region: config.collectionPrep.region,
      prepDate: config.collectionPrep.prepDate,
      testTag: config.collectionPrep.testTag,
      collectionPrepName,
    };

    const collectionPrepResult = await services.createCollectionPrepHandler.execute(collectionPrepRequest);
    collectionPrepId = collectionPrepResult.collectionPrepId;
    console.log(OutputFormatter.success(`Created collection prep: ${collectionPrepId}\n`));
  }

  // Build WMS result from polling (COS created the entities)
  const wmsResult = {
    orders: pollingResult.foundOrders.map((o) => ({ orderId: o.wmsOrderId })),
    shipments: [], // Shipments created by collection prep, not tracked here
    failures: [],
  };

  // Save progress state
  const progressState: ProgressState = {
    batchId,
    timestamp: Date.now(),
    shopifyOrders: {
      successful: finalShopifyResult.shopifyOrders.map((order, index) => ({
        orderIndex: index,
        shopifyOrderId: order.shopifyOrderId,
        shopifyOrderNumber: order.shopifyOrderNumber,
        customerEmail: config.orders[index]?.customer.email || "",
      })),
      failed: finalShopifyResult.failures || [],
    },
    wmsEntities: {
      successful: pollingResult.foundOrders.map((order, index) => ({
        orderIndex: index,
        orderId: order.wmsOrderId,
        shopifyOrderId: order.shopifyOrderId,
        prepPartItems: [], // COS webhook creates these, we don't track them individually
      })),
      failed: [],
      shipments: [], // Shipments created by collection prep
    },
    collectionPrep: collectionPrepId ? { collectionPrepId, region: config.collectionPrep!.region } : undefined,
  };
  saveProgressState(progressState);

  const collectionPrepResult = collectionPrepId
    ? { collectionPrepId, region: config.collectionPrep!.region }
    : undefined;

  // Delete progress state on successful completion
  if (!finalShopifyResult.failures || finalShopifyResult.failures.length === 0) {
    deleteProgressState(batchId);
  }

  return { shopifyResult: finalShopifyResult, wmsResult, collectionPrepResult };
}

/**
 * Execute dry-run mode: simulate full flow without making actual changes
 * Always uses direct mode (webhook mode requires real Shopify orders)
 */
export async function executeDryRun(configFilePath: string, services: ServiceDependencies): Promise<void> {
  console.log(OutputFormatter.header("DRY RUN MODE - No changes will be made", "🔍"));
  console.log(OutputFormatter.separator());
  console.log();

  const config = parseAndValidateConfig(configFilePath, services.inputParser);
  await validateData(config, services.dataValidator);

  // Generate batch ID for this run
  const batchId = uuidv4();
  console.log(OutputFormatter.keyValue("Batch ID", batchId));
  console.log();

  // Dry-run always uses direct mode (can't dry-run webhook ingestion)
  const options: ExecutionOptions = {
    useWebhookMode: false,
    pollingTimeout: 180,
    pollingInterval: 2,
  };

  const { shopifyResult, wmsResult, collectionPrepResult } = await executeSeedingFlow(
    config,
    services,
    batchId,
    true,
    options,
  );

  displaySummary(shopifyResult, wmsResult, collectionPrepResult, true);
}
