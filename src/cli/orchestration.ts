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
  const step1Label = isDryRun ? "Would seed" : "Seeding";
  const step1Name = `${step1Label} Shopify orders`;
  const totalSteps = config.collectionPrep ? 3 : 2;
  console.log(OutputFormatter.step(1, totalSteps, step1Name));
  
  const progressTracker = new ProgressTracker();
  progressTracker.start(step1Name, config.orders.length);
  
  const shopifyRequest = {
    orders: config.orders.map((order) => ({
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
      progressTracker.update(current, customerEmail);
    },
  };

  const shopifyResult = await services.seedShopifyOrdersHandler.execute(shopifyRequest);
  progressTracker.complete();
  
  const createdLabel = isDryRun ? "Would create" : "Created";
  const successCount = shopifyResult.shopifyOrders.length;
  const totalCount = config.orders.length;
  
  if (shopifyResult.failures && shopifyResult.failures.length > 0) {
    console.log(OutputFormatter.warning(`${createdLabel} ${successCount}/${totalCount} Shopify order(s). ${shopifyResult.failures.length} failed.\n`));
  } else {
    console.log(OutputFormatter.success(`${createdLabel} ${successCount} Shopify order(s)\n`));
  }

  // Handle partial failures from Shopify seeding
  if (shopifyResult.failures && shopifyResult.failures.length > 0) {
    console.log(OutputFormatter.section("Shopify Seeding Failures", [
      OutputFormatter.listItem(`Failed: ${shopifyResult.failures.length} of ${totalCount} orders`),
      ...shopifyResult.failures.map((failure) =>
        OutputFormatter.listItem(
          `Order ${failure.orderIndex + 1} (${failure.customerEmail}): ${failure.error}`,
          2,
        ),
      ),
    ]));
    
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
  wmsProgressTracker.start(step2Name, shopifyResult.shopifyOrders.length);
  
  const wmsRequest = {
    shopifyOrders: shopifyResult.shopifyOrders.map((shopifyOrder, index) => {
      const configOrder = config.orders[index];
      const lineItemsWithQuantity = shopifyOrder.lineItems.map((shopifyItem) => {
        const configItem = configOrder.lineItems.find((item) => item.sku === shopifyItem.sku);
        return {
          lineItemId: shopifyItem.lineItemId,
          sku: shopifyItem.sku,
          quantity: configItem?.quantity || 1,
        };
      });

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
      wmsProgressTracker.update(current, shopifyOrderId);
    },
  };

  const wmsResult = await services.seedWmsEntitiesHandler.execute(wmsRequest);
  wmsProgressTracker.complete();
  
  const wmsSuccessCount = wmsResult.orders.length;
  const wmsTotalCount = shopifyResult.shopifyOrders.length;
  
  if (wmsResult.failures && wmsResult.failures.length > 0) {
    console.log(OutputFormatter.warning(`${createdLabel} ${wmsSuccessCount}/${wmsTotalCount} WMS order(s). ${wmsResult.failures.length} failed.`));
    console.log(OutputFormatter.warning(`${createdLabel} ${wmsResult.shipments.length} shipment(s)\n`));
  } else {
    console.log(OutputFormatter.success(`${createdLabel} ${wmsSuccessCount} WMS order(s)`));
    console.log(OutputFormatter.success(`${createdLabel} ${wmsResult.shipments.length} shipment(s)\n`));
  }
  
  // Handle partial failures from WMS seeding
  if (wmsResult.failures && wmsResult.failures.length > 0) {
    console.log(OutputFormatter.section("WMS Seeding Failures", [
      OutputFormatter.listItem(`Failed: ${wmsResult.failures.length} of ${wmsTotalCount} orders`),
      ...wmsResult.failures.map((failure) =>
        OutputFormatter.listItem(
          `Order ${failure.orderIndex + 1} (${failure.shopifyOrderId}${failure.customerEmail ? `, ${failure.customerEmail}` : ""}): ${failure.error}`,
          2,
        ),
      ),
    ]));
    console.log();
  }

  const collectionPrepResult = collectionPrepId
    ? { collectionPrepId, region: config.collectionPrep!.region }
    : undefined;

  return { shopifyResult, wmsResult, collectionPrepResult };
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
