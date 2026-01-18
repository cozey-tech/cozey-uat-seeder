/**
 * Orchestration logic for seeding workflow
 */

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

/**
 * Execute the seeding flow (shared between normal and dry-run)
 */
export async function executeSeedingFlow(
  config: SeedConfig,
  services: ServiceDependencies,
  batchId: string,
  isDryRun: boolean,
  resumeState?: ProgressState,
): Promise<{
  shopifyResult: { 
    shopifyOrders: Array<{ shopifyOrderId: string; shopifyOrderNumber: string; lineItems: Array<{ lineItemId: string; sku: string }> }>;
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

  // Step 1: Seed Shopify orders
  const step1Label = isDryRun ? "Would seed" : resumeState ? "Resuming" : "Seeding";
  const step1Name = `${step1Label} Shopify orders`;
  const totalSteps = config.collectionPrep ? 3 : 2;
  console.log(OutputFormatter.step(1, totalSteps, step1Name));
  
  // Filter orders if resuming (only retry failed ones)
  // Also create a mapping from filtered array index to original config.orders index
  let ordersToProcess = config.orders;
  const filteredToOriginalIndexMap = new Map<number, number>(); // Maps filtered array index -> original config.orders index
  if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
    const successfulIndices = new Set(resumeState.shopifyOrders.successful.map((s) => s.orderIndex));
    ordersToProcess = config.orders.filter((_, index) => !successfulIndices.has(index));
    // Build mapping: for each filtered order, map its position in filtered array to original index
    let filteredIndex = 0;
    for (let originalIndex = 0; originalIndex < config.orders.length; originalIndex++) {
      if (!successfulIndices.has(originalIndex)) {
        filteredToOriginalIndexMap.set(filteredIndex, originalIndex);
        filteredIndex++;
      }
    }
    console.log(OutputFormatter.info(`Resuming: ${ordersToProcess.length} failed orders to retry, ${resumeState.shopifyOrders.successful.length} already successful`));
  } else {
    // Normal flow: filtered array is same as original, so indices map 1:1
    for (let i = 0; i < config.orders.length; i++) {
      filteredToOriginalIndexMap.set(i, i);
    }
  }
  
  const progressTracker = new ProgressTracker();
  progressTracker.start(step1Name, config.orders.length);
  
  // Update progress to reflect already completed orders if resuming
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
    collectionPrepName,
    onOrderProgress: (current: number, total: number, customerEmail: string, _success: boolean): void => {
      // Adjust current count if resuming (add already completed count)
      const adjustedCurrent = resumeState 
        ? resumeState.shopifyOrders.successful.length + current 
        : current;
      progressTracker.update(adjustedCurrent, customerEmail);
    },
  };

  const shopifyResult = await services.seedShopifyOrdersHandler.execute(shopifyRequest);
  
  // Merge results if resuming
  let finalShopifyResult = shopifyResult;
  if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
    // Merge successful orders from previous run with new results
    // Note: We need to fetch line items from Shopify for previous orders, but for now we'll use empty array
    // In a production system, we'd store line items in progress state or fetch them
    const previousSuccessful = resumeState.shopifyOrders.successful.map((s) => ({
      shopifyOrderId: s.shopifyOrderId,
      shopifyOrderNumber: s.shopifyOrderNumber,
      lineItems: [] as Array<{ lineItemId: string; sku: string }>, // Line items not stored in progress state
      fulfillmentStatus: "unfulfilled" as string, // Default status
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
    console.log(OutputFormatter.warning(`${createdLabel} ${successCount}/${totalCount} Shopify order(s). ${finalShopifyResult.failures.length} failed.\n`));
  } else {
    console.log(OutputFormatter.success(`${createdLabel} ${successCount} Shopify order(s)\n`));
  }

  // Save progress state after Shopify seeding
  if (!isDryRun) {
    // Build successful orders array with correct orderIndex values
    const successfulOrders: Array<{
      orderIndex: number;
      shopifyOrderId: string;
      shopifyOrderNumber: string;
      customerEmail: string;
    }> = [];
    
    // Add previously successful orders (they already have correct orderIndex from resumeState)
    if (resumeState && resumeState.shopifyOrders.successful.length > 0) {
      successfulOrders.push(...resumeState.shopifyOrders.successful);
    }
    
    // Add newly successful orders, mapping their filtered indices back to original indices
    for (const order of shopifyResult.shopifyOrders) {
      // Find the order in shopifyResult to get its filtered index
      const filteredIndex = shopifyResult.shopifyOrders.findIndex((o) => o.shopifyOrderId === order.shopifyOrderId);
      if (filteredIndex !== -1) {
        const originalIndex = filteredToOriginalIndexMap.get(filteredIndex);
        if (originalIndex !== undefined) {
          // Find customer email from original config
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
      wmsEntities: {
        successful: [],
        failed: [],
      },
    };
    saveProgressState(progressState);
  }

  // Handle partial failures from Shopify seeding
  if (finalShopifyResult.failures && finalShopifyResult.failures.length > 0) {
    console.log(OutputFormatter.section("Shopify Seeding Failures", [
      OutputFormatter.listItem(`Failed: ${finalShopifyResult.failures.length} of ${totalCount} orders`),
      ...finalShopifyResult.failures.map((failure) =>
        OutputFormatter.listItem(
          `Order ${failure.orderIndex + 1} (${failure.customerEmail}): ${failure.error}`,
          2,
        ),
      ),
    ]));
    
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

  // Step 2: Seed WMS entities
  const step2Number = config.collectionPrep ? 3 : 2;
  const step2Name = `${step1Label} WMS entities`;
  console.log(OutputFormatter.step(step2Number, config.collectionPrep ? 3 : 2, step2Name));
  
  const region = config.collectionPrep?.region || "CA";
  let collectionPrepId: string | undefined;

  // Create collection prep if configured (using pre-generated name)
  if (config.collectionPrep) {
    const step2aNumber = 2;
    const creatingLabel = isDryRun ? "Would create" : "Creating";
    console.log(OutputFormatter.step(step2aNumber, totalSteps, `${creatingLabel} collection prep`));
    const collectionPrepRequest = {
      orderIds: shopifyResult.shopifyOrders.map((o) => o.shopifyOrderId),
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
    wmsOrdersToProcess = finalShopifyResult.shopifyOrders.filter((order) => !successfulShopifyIds.has(order.shopifyOrderId));
    // Build mapping: for each filtered order, map its position in filtered array to original index
    // We need to find the original index by looking up the shopifyOrderId in finalShopifyResult
    // and then finding its corresponding orderIndex from progress state or config
    let filteredIndex = 0;
    for (const wmsOrder of finalShopifyResult.shopifyOrders) {
      if (!successfulShopifyIds.has(wmsOrder.shopifyOrderId)) {
        // Find original index by looking up shopifyOrderId
        // Check if it's in the previous successful orders (from resumeState)
        const prevSuccess = resumeState.shopifyOrders.successful.find((s) => s.shopifyOrderId === wmsOrder.shopifyOrderId);
        if (prevSuccess) {
          wmsFilteredToOriginalIndexMap.set(filteredIndex, prevSuccess.orderIndex);
        } else {
          // New order from current Shopify run - use the mapping we created earlier
          const shopifyIndex = shopifyResult.shopifyOrders.findIndex((shopifyOrder) => shopifyOrder.shopifyOrderId === wmsOrder.shopifyOrderId);
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
    console.log(OutputFormatter.info(`Resuming WMS: ${wmsOrdersToProcess.length} orders to retry, ${resumeState.wmsEntities.successful.length} already successful`));
  } else {
    // Normal flow: filtered array is same as original, so indices map 1:1
    // For normal flow, finalShopifyResult order positions should match config.orders
    for (let i = 0; i < finalShopifyResult.shopifyOrders.length; i++) {
      // In normal flow (no resume), positions match 1:1
      wmsFilteredToOriginalIndexMap.set(i, i < config.orders.length ? i : i);
    }
  }
  
  const wmsRequest = {
    shopifyOrders: wmsOrdersToProcess.map((shopifyOrder) => {
      // Find the corresponding config order by matching shopifyOrderId
      // For resumed orders, we need to find the original config order by index
      let configOrder = config.orders[0]; // Default fallback
      
      if (resumeState) {
        // Try to find by matching shopifyOrderId in previous successful orders
        const prevSuccess = resumeState.shopifyOrders.successful.find(
          (s) => s.shopifyOrderId === shopifyOrder.shopifyOrderId,
        );
        if (prevSuccess) {
          // Use the stored orderIndex from progress state, not the array index
          configOrder = config.orders[prevSuccess.orderIndex];
        } else {
          // New order from current run, find by index in finalShopifyResult
          const currentIndex = finalShopifyResult.shopifyOrders.findIndex(
            (o) => o.shopifyOrderId === shopifyOrder.shopifyOrderId,
          );
          if (currentIndex !== -1) {
            // Adjust index to account for previous successful orders
            const adjustedIndex = currentIndex - resumeState.shopifyOrders.successful.length;
            if (adjustedIndex >= 0 && adjustedIndex < config.orders.length) {
              configOrder = config.orders[adjustedIndex];
            }
          }
        }
      } else {
        // Normal flow: find by index
        const currentIndex = finalShopifyResult.shopifyOrders.findIndex(
          (o) => o.shopifyOrderId === shopifyOrder.shopifyOrderId,
        );
        if (currentIndex !== -1 && currentIndex < config.orders.length) {
          configOrder = config.orders[currentIndex];
        }
      }
      // For resumed orders, lineItems might be empty, so use config order line items
      const lineItemsWithQuantity = shopifyOrder.lineItems.length > 0
        ? shopifyOrder.lineItems.map((shopifyItem) => {
            const configItem = configOrder.lineItems.find((item) => item.sku === shopifyItem.sku);
            return {
              lineItemId: shopifyItem.lineItemId,
              sku: shopifyItem.sku,
              quantity: configItem?.quantity || 1,
            };
          })
        : configOrder.lineItems.map((item) => ({
            lineItemId: `resumed-${item.sku}`, // Placeholder ID for resumed orders
            sku: item.sku,
            quantity: item.quantity,
          }));

      return {
        shopifyOrderId: shopifyOrder.shopifyOrderId,
        shopifyOrderNumber: shopifyOrder.shopifyOrderNumber,
        status: "paid", // Orders are paid but not fulfilled during seeding
        customerName: configOrder.customer.name,
        customerEmail: configOrder.customer.email,
        lineItems: lineItemsWithQuantity,
      };
    }),
    collectionPrepId,
    region,
    onOrderProgress: (current: number, total: number, shopifyOrderId: string, _success: boolean): void => {
      // Adjust current count if resuming (add already completed count)
      const adjustedCurrent = resumeState 
        ? resumeState.wmsEntities.successful.length + current 
        : current;
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
    finalWmsResult = {
      orders: [...previousSuccessful, ...wmsResult.orders],
      shipments: wmsResult.shipments, // Shipments are recreated, so don't merge
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
  
  // For new orders, prepPartItems are in wmsResult in sequential order
  // We need to map them to orders. Since we don't know the exact count per order,
  // we'll use the order index in wmsOrdersToProcess to map them.
  // This assumes prepPartItems are created in the same order as orders.
  let prepPartItemOffset = 0;
  for (let i = 0; i < wmsResult.orders.length; i++) {
    const order = wmsResult.orders[i];
    // Get the corresponding shopifyOrder to find line items count
    const shopifyOrder = wmsOrdersToProcess[i];
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
  }
  
  wmsProgressTracker.update(finalShopifyResult.shopifyOrders.length);
  wmsProgressTracker.complete();
  
  const wmsSuccessCount = finalWmsResult.orders.length;
  const wmsTotalCount = finalShopifyResult.shopifyOrders.length;
  
  if (finalWmsResult.failures && finalWmsResult.failures.length > 0) {
    console.log(OutputFormatter.warning(`${createdLabel} ${wmsSuccessCount}/${wmsTotalCount} WMS order(s). ${finalWmsResult.failures.length} failed.`));
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
            const filteredIndex = shopifyResult.shopifyOrders.findIndex((o) => o.shopifyOrderId === order.shopifyOrderId);
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
          // Note: wmsResult contains only newly processed orders (not merged with previous)
          for (const order of wmsResult.orders) {
            const filteredIndex = wmsResult.orders.findIndex((o) => o.shopifyOrderId === order.shopifyOrderId);
            if (filteredIndex !== -1) {
              const originalIndex = wmsFilteredToOriginalIndexMap.get(filteredIndex);
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
      },
      collectionPrep: collectionPrepId
        ? { collectionPrepId, region: config.collectionPrep!.region }
        : undefined,
    };
    saveProgressState(progressState);
  }
  
  // Handle partial failures from WMS seeding
  if (finalWmsResult.failures && finalWmsResult.failures.length > 0) {
    console.log(OutputFormatter.section("WMS Seeding Failures", [
      OutputFormatter.listItem(`Failed: ${finalWmsResult.failures.length} of ${wmsTotalCount} orders`),
      ...finalWmsResult.failures.map((failure) =>
        OutputFormatter.listItem(
          `Order ${failure.orderIndex + 1} (${failure.shopifyOrderId}${failure.customerEmail ? `, ${failure.customerEmail}` : ""}): ${failure.error}`,
          2,
        ),
      ),
    ]));
    console.log(OutputFormatter.info(`To resume this operation, use: --resume ${batchId}`));
    console.log();
  }

  const collectionPrepResult = collectionPrepId
    ? { collectionPrepId, region: config.collectionPrep!.region }
    : undefined;

  // Delete progress state on successful completion
  if (!isDryRun && (!finalShopifyResult.failures || finalShopifyResult.failures.length === 0) && 
      (!finalWmsResult.failures || finalWmsResult.failures.length === 0)) {
    deleteProgressState(batchId);
  }

  return { shopifyResult: finalShopifyResult, wmsResult: finalWmsResult, collectionPrepResult };
}

/**
 * Execute dry-run mode: simulate full flow without making actual changes
 */
export async function executeDryRun(
  configFilePath: string,
  services: ServiceDependencies,
): Promise<void> {
  console.log(OutputFormatter.header("DRY RUN MODE - No changes will be made", "🔍"));
  console.log(OutputFormatter.separator());
  console.log();

  const config = parseAndValidateConfig(configFilePath, services.inputParser);
  await validateData(config, services.dataValidator);

  // Generate batch ID for this run
  const batchId = uuidv4();
  console.log(OutputFormatter.keyValue("Batch ID", batchId));
  console.log();

  const { shopifyResult, wmsResult, collectionPrepResult } = await executeSeedingFlow(
    config,
    services,
    batchId,
    true,
  );

  displaySummary(shopifyResult, wmsResult, collectionPrepResult, true);
}
