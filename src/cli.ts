#!/usr/bin/env node

/**
 * CLI Entry Point for Cozey UAT Seeder
 *
 * Orchestrates the full seeding workflow:
 * 1. Validates staging environment
 * 2. Parses and validates configuration file
 * 3. Seeds Shopify orders
 * 4. Seeds WMS entities
 * 5. Creates collection prep (if configured)
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env first, then .env.local (which will override .env values)
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { Command } from "commander";
import { seedVersion } from "./index";
import { initializeEnvConfig } from "./config/env";
import { assertStagingEnvironment, displayStagingEnvironment } from "./config/stagingGuardrails";
import { InputParserService } from "./services/InputParserService";
import { DataValidationService } from "./services/DataValidationService";
import { ShopifyService } from "./services/ShopifyService";
import { WmsService } from "./services/WmsService";
import { CollectionPrepService } from "./services/CollectionPrepService";
import { WmsPrismaRepository } from "./repositories/prisma/WmsPrismaRepository";
import { SeedShopifyOrdersHandler } from "./business/seedShopifyOrders/SeedShopifyOrdersHandler";
import { SeedShopifyOrdersUseCase } from "./business/seedShopifyOrders/SeedShopifyOrdersUseCase";
import { SeedWmsEntitiesHandler } from "./business/seedWmsEntities/SeedWmsEntitiesHandler";
import { SeedWmsEntitiesUseCase } from "./business/seedWmsEntities/SeedWmsEntitiesUseCase";
import { CreateCollectionPrepHandler } from "./business/createCollectionPrep/CreateCollectionPrepHandler";
import { CreateCollectionPrepUseCase } from "./business/createCollectionPrep/CreateCollectionPrepUseCase";
import { StagingGuardrailError } from "./shared/errors/StagingGuardrailError";
import { InputValidationError } from "./services/InputParserService";
import { DataValidationError } from "./services/DataValidationService";
import type { SeedConfig } from "./shared/types/SeedConfig";
import { ProgressTracker } from "./utils/progress";
import { ErrorFormatter } from "./utils/errorFormatter";
import { OutputFormatter } from "./utils/outputFormatter";
import { InteractivePromptService } from "./services/InteractivePromptService";

interface CliOptions {
  configFile: string;
  skipConfirmation: boolean;
  validate: boolean;
  dryRun: boolean;
}

/**
 * Parse command line arguments using commander
 */
function parseArgs(): CliOptions {
  const program = new Command();

  program
    .name("seed")
    .description("Seeder for Shopify staging orders and WMS staging entities")
    .version(seedVersion, "-v, --version", "display version number")
    .argument("<config-file>", "Path to seed configuration JSON file")
    .option("--validate", "Validate config file schema only (no DB/API calls)")
    .option("--dry-run", "Simulate seeding without making changes")
    .option("--skip-confirmation", "Skip staging confirmation prompt")
    .addHelpText(
      "after",
      `
Examples:
  $ npm run seed config.json
  $ npm run seed config.json --validate
  $ npm run seed config.json --dry-run
  $ npm run seed config.json --skip-confirmation

For more information, see README.md
      `,
    );

  program.parse();

  const options = program.opts();
  const configFile = program.args[0];

  // Validate flags are mutually exclusive
  if (options.validate && options.dryRun) {
    console.error("Error: --validate and --dry-run cannot be used together\n");
    program.help();
    process.exit(1);
  }

  if (!configFile) {
    console.error("Error: config file path is required\n");
    program.help();
    process.exit(1);
  }

  return {
    configFile,
    skipConfirmation: options.skipConfirmation || false,
    validate: options.validate || false,
    dryRun: options.dryRun || false,
  };
}

/**
 * Validate configuration file against schema
 */
async function validateConfig(configFilePath: string): Promise<void> {
  const inputParser = new InputParserService();

  try {
    const config = inputParser.parseInputFile(configFilePath);

    // Note: pnpConfig is optional - boxes already exist in the database
    // If pnpConfig is provided, validate it, but don't require it for PnP items
    if (config.pnpConfig) {
      if (!config.pnpConfig.packageInfo || config.pnpConfig.packageInfo.length === 0) {
        throw new InputValidationError("pnpConfig provided but no packageInfo defined");
      }
      if (!config.pnpConfig.boxes || config.pnpConfig.boxes.length === 0) {
        throw new InputValidationError("pnpConfig provided but no boxes defined");
      }
    }

    // Display validation results
    const validationItems: Array<{ label: string; value: string | number }> = [
      { label: "Schema", value: "Valid" },
      { label: "Orders", value: config.orders.length },
      { label: "Collection Prep", value: config.collectionPrep ? "Configured" : "Not configured" },
    ];
    if (config.pnpConfig) {
      validationItems.push({ label: "PnP Config", value: "Present" });
    }
    
    console.log(OutputFormatter.summary({
      title: OutputFormatter.success("Configuration file validation passed"),
      items: validationItems,
    }));
  } catch (error) {
    if (error instanceof InputValidationError) {
      const formattedError = ErrorFormatter.formatAsString(error, { step: "Config validation" });
      console.error(`\n${formattedError}\n`);
      process.exit(1);
    }
    // Handle file I/O errors, permission errors, etc.
    const formattedError = ErrorFormatter.formatAsString(
      error instanceof Error ? error : new Error(String(error)),
      { step: "Config file reading" },
    );
    console.error(`\n${formattedError}\n`);
    process.exit(1);
  }
}

/**
 * Service dependencies container
 */
interface ServiceDependencies {
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
function initializeServices(dryRun: boolean): ServiceDependencies {
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
 * Parse and validate configuration file
 */
function parseAndValidateConfig(
  configFilePath: string,
  inputParser: InputParserService,
): SeedConfig {
  console.log(`📄 Parsing configuration file: ${configFilePath}`);
  try {
    return inputParser.parseInputFile(configFilePath);
  } catch (error) {
    if (error instanceof InputValidationError) {
      console.error(`❌ Configuration file validation failed:\n${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Validate data (SKUs, customers, etc.)
 */
async function validateData(
  config: SeedConfig,
  dataValidator: DataValidationService,
): Promise<void> {
  console.log(OutputFormatter.info("Validating data..."));
  try {
    await dataValidator.validateSeedConfig(config);
  } catch (error) {
    if (error instanceof DataValidationError) {
      const formattedError = ErrorFormatter.formatAsString(error, { step: "Data validation" });
      console.error(`\n${formattedError}\n`);
      process.exit(1);
    }
    throw error;
  }
  console.log(OutputFormatter.success("Data validation passed\n"));
}

/**
 * Execute the seeding flow (shared between normal and dry-run)
 */
async function executeSeedingFlow(
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
  };

  const shopifyResult = await services.seedShopifyOrdersHandler.execute(shopifyRequest);
  progressTracker.update(config.orders.length);
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
  };

  const wmsResult = await services.seedWmsEntitiesHandler.execute(wmsRequest);
  wmsProgressTracker.update(shopifyResult.shopifyOrders.length);
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
 * Display summary of seeding results
 */
function displaySummary(
  shopifyResult: { 
    shopifyOrders: Array<{ shopifyOrderId: string; shopifyOrderNumber: string }>;
    failures?: Array<{ orderIndex: number; customerEmail: string; error: string }>;
  },
  wmsResult: { 
    orders: Array<{ orderId: string }>; 
    shipments: Array<{ shipmentId: string }>;
    failures?: Array<{ orderIndex: number; shopifyOrderId: string; customerEmail?: string; error: string }>;
  },
  collectionPrepResult?: { collectionPrepId: string; region: string },
  isDryRun = false,
): void {
  const items: Array<{ label: string; value: string | number }> = [];
  
  const shopifySuccess = shopifyResult.shopifyOrders.length;
  const shopifyFailures = shopifyResult.failures?.length || 0;
  const shopifyTotal = shopifySuccess + shopifyFailures;
  
  items.push({
    label: `Shopify Orders ${isDryRun ? "Would Be" : "Created"}`,
    value: shopifyFailures > 0 ? `${shopifySuccess}/${shopifyTotal}` : shopifySuccess,
  });
  
  const wmsSuccess = wmsResult.orders.length;
  const wmsFailures = wmsResult.failures?.length || 0;
  const wmsTotal = wmsSuccess + wmsFailures;
  
  items.push({
    label: "WMS Orders",
    value: wmsFailures > 0 ? `${wmsSuccess}/${wmsTotal}` : wmsSuccess,
  });
  
  items.push({
    label: "WMS Shipments",
    value: wmsResult.shipments.length,
  });

  if (collectionPrepResult) {
    items.push({
      label: "Collection Prep ID",
      value: collectionPrepResult.collectionPrepId,
    });
    items.push({
      label: "Collection Prep Region",
      value: collectionPrepResult.region,
    });
  }
  
  if (shopifyFailures > 0 || wmsFailures > 0) {
    items.push({
      label: "Total Failures",
      value: (shopifyFailures || 0) + (wmsFailures || 0),
    });
  }

  console.log();
  console.log(OutputFormatter.summary({
    title: isDryRun 
      ? OutputFormatter.header("DRY RUN MODE - No changes will be made", "🔍")
      : OutputFormatter.success("Seeding Complete!"),
    items,
  }));
  
  // Show detailed order list if small number
  if (shopifyResult.shopifyOrders.length <= 10) {
    console.log(OutputFormatter.header("Shopify Orders", "📦"));
    shopifyResult.shopifyOrders.forEach((order) => {
      console.log(OutputFormatter.listItem(`Order #${order.shopifyOrderNumber} (ID: ${order.shopifyOrderId})`));
    });
    console.log();
  }
  
  if (isDryRun) {
    console.log(OutputFormatter.warning("DRY RUN - No actual changes were made"));
    console.log();
  }
}

/**
 * Check and display staging environment
 */
function checkStagingEnvironment(): void {
  const envInfo = displayStagingEnvironment();
  const statusEmoji = envInfo.isStaging ? "✅" : "❌";
  const statusText = envInfo.isStaging ? "Staging" : "Not Staging";
  
  console.log(OutputFormatter.summary({
    title: OutputFormatter.header("Staging Environment Check", "🔒"),
    items: [
      { label: "Database", value: envInfo.databaseUrl },
      { label: "Shopify", value: envInfo.shopifyDomain },
      { label: "Status", value: `${statusEmoji} ${statusText}` },
    ],
  }));
  console.log();

  try {
    assertStagingEnvironment();
  } catch (error) {
    if (error instanceof StagingGuardrailError) {
      const formattedError = ErrorFormatter.formatAsString(error, { step: "Staging environment check" });
      console.error(`\n${formattedError}\n`);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Execute dry-run mode: simulate full flow without making actual changes
 */
async function executeDryRun(configFilePath: string): Promise<void> {
  console.log(OutputFormatter.header("DRY RUN MODE - No changes will be made", "🔍"));
  console.log(OutputFormatter.separator());
  console.log();

  // Config is already initialized in main(), so staging check can proceed
  checkStagingEnvironment();

  // Initialize services with dryRun=true
  console.log(OutputFormatter.info("Initializing services (DRY RUN mode)..."));
  const initProgress = new ProgressTracker({ showSpinner: false });
  initProgress.start("Initializing", 4);
  
  initProgress.update(1, "Connecting to database...");
  const services = initializeServices(true);
  initProgress.update(2, "Initializing Shopify client...");
  initProgress.update(3, "Loading reference data...");
  initProgress.update(4, "Ready");
  initProgress.complete("Services initialized");
  console.log();
  
  try {
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
  } finally {
    // Cleanup
    await services.prisma.$disconnect();
  }
}

/**
 * Main orchestrator function
 */
async function main(): Promise<void> {
  try {
    // Initialize environment configuration (load from AWS Secrets Manager or .env)
    await initializeEnvConfig();

    // Parse CLI arguments
    const options = parseArgs();

    // Handle --validate flag (early exit, no DB/API calls)
    if (options.validate) {
      await validateConfig(options.configFile);
      process.exit(0);
    }

    // Handle --dry-run flag
    if (options.dryRun) {
      await executeDryRun(options.configFile);
      process.exit(0);
    }

    checkStagingEnvironment();

    // Initialize services
    console.log(OutputFormatter.info("Initializing services..."));
    const initProgress = new ProgressTracker({ showSpinner: false });
    initProgress.start("Initializing", 4);
    
    initProgress.update(1, "Connecting to database...");
    const services = initializeServices(false);
    initProgress.update(2, "Initializing Shopify client...");
    initProgress.update(3, "Loading reference data...");
    initProgress.update(4, "Ready");
    initProgress.complete("Services initialized");
    console.log();
    try {
      const config = parseAndValidateConfig(options.configFile, services.inputParser);
      await validateData(config, services.dataValidator);

      // Generate batch ID for this run
      const batchId = uuidv4();
      console.log(OutputFormatter.keyValue("Batch ID", batchId));
      console.log();

      const { shopifyResult, wmsResult, collectionPrepResult } = await executeSeedingFlow(
        config,
        services,
        batchId,
        false,
      );

      displaySummary(shopifyResult, wmsResult, collectionPrepResult, false);
    } finally {
      // Cleanup
      await services.prisma.$disconnect();
    }
  } catch (error) {
    const errorContext = { step: "Seeding operation" };
    const formattedError = ErrorFormatter.formatAsString(
      error instanceof Error ? error : new Error(String(error)),
      errorContext,
    );
    console.error(`\n${formattedError}\n`);
    
    if (error instanceof Error && error.stack && process.env.NODE_ENV === "development") {
      console.error(`Stack trace:\n${error.stack}\n`);
    }
    
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
