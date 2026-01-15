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

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
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

interface CliOptions {
  configFile: string;
  skipConfirmation: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npm run seed <config-file.json> [--skip-confirmation]");
    process.exit(1);
  }

  const configFile = args[0];
  const skipConfirmation = args.includes("--skip-confirmation");

  return { configFile, skipConfirmation };
}

/**
 * Display summary of seeding results
 */
function displaySummary(
  shopifyResult: { shopifyOrders: Array<{ shopifyOrderId: string; shopifyOrderNumber: string }> },
  wmsResult: { orders: Array<{ orderId: string }>; shipments: Array<{ shipmentId: string }> },
  collectionPrepResult?: { collectionPrepId: string; region: string },
): void {
  console.log("\n✅ Seeding Complete!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📦 Shopify Orders Created: ${shopifyResult.shopifyOrders.length}`);
  shopifyResult.shopifyOrders.forEach((order) => {
    console.log(`   - Order #${order.shopifyOrderNumber} (ID: ${order.shopifyOrderId})`);
  });

  console.log(`\n🗄️  WMS Entities Created:`);
  console.log(`   - Orders: ${wmsResult.orders.length}`);
  console.log(`   - Shipments: ${wmsResult.shipments.length}`);

  if (collectionPrepResult) {
    console.log(`\n📋 Collection Prep Created:`);
    console.log(`   - ID: ${collectionPrepResult.collectionPrepId}`);
    console.log(`   - Region: ${collectionPrepResult.region}`);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

/**
 * Main orchestrator function
 */
async function main(): Promise<void> {
  try {
    // Parse CLI arguments
    const options = parseArgs();

    // Display staging environment info
    const envInfo = displayStagingEnvironment();
    console.log("🔒 Staging Environment Check");
    console.log(`   Database: ${envInfo.databaseUrl}`);
    console.log(`   Shopify: ${envInfo.shopifyDomain}`);
    console.log(`   Status: ${envInfo.isStaging ? "✅ Staging" : "❌ Not Staging"}\n`);

    // Assert staging environment
    try {
      assertStagingEnvironment();
    } catch (error) {
      if (error instanceof StagingGuardrailError) {
        console.error("❌ Staging Guardrail Violation:");
        console.error(`   ${error.message}\n`);
        console.error("This tool can only run against staging environments.");
        process.exit(1);
      }
      throw error;
    }

    // Initialize services
    console.log("🔧 Initializing services...");
    const prisma = new PrismaClient();
    const wmsRepository = new WmsPrismaRepository(prisma);
    const shopifyService = new ShopifyService();
    const wmsService = new WmsService(wmsRepository);
    const collectionPrepService = new CollectionPrepService(wmsRepository);
    const inputParser = new InputParserService();
    const dataValidator = new DataValidationService(prisma);

    // Initialize use cases and handlers
    const seedShopifyOrdersUseCase = new SeedShopifyOrdersUseCase(shopifyService);
    const seedShopifyOrdersHandler = new SeedShopifyOrdersHandler(seedShopifyOrdersUseCase);

    const seedWmsEntitiesUseCase = new SeedWmsEntitiesUseCase(wmsService);
    const seedWmsEntitiesHandler = new SeedWmsEntitiesHandler(seedWmsEntitiesUseCase);

    const createCollectionPrepUseCase = new CreateCollectionPrepUseCase(collectionPrepService);
    const createCollectionPrepHandler = new CreateCollectionPrepHandler(createCollectionPrepUseCase);

    // Parse and validate configuration file
    console.log(`📄 Parsing configuration file: ${options.configFile}`);
    let config;
    try {
      config = inputParser.parseInputFile(options.configFile);
    } catch (error) {
      if (error instanceof InputValidationError) {
        console.error(`❌ Configuration file validation failed:\n${error.message}\n`);
        process.exit(1);
      }
      throw error;
    }

    // Validate data (SKUs, customers, etc.)
    console.log("🔍 Validating data...");
    try {
      await dataValidator.validateSeedConfig(config);
    } catch (error) {
      if (error instanceof DataValidationError) {
        console.error(`❌ Data validation failed:\n${error.message}\n`);
        process.exit(1);
      }
      throw error;
    }
    console.log("✅ Data validation passed\n");

    // Generate batch ID for this run
    const batchId = uuidv4();
    console.log(`🆔 Batch ID: ${batchId}\n`);

    // Step 1: Seed Shopify orders
    console.log("🛒 Step 1: Seeding Shopify orders...");
    const shopifyRequest = {
      orders: config.orders.map((order) => ({
        customer: order.customer,
        lineItems: order.lineItems.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
        })),
      })),
      batchId,
    };

    const shopifyResult = await seedShopifyOrdersHandler.execute(shopifyRequest);
    console.log(`✅ Created ${shopifyResult.shopifyOrders.length} Shopify order(s)\n`);

    // Step 2: Seed WMS entities
    console.log("🗄️  Step 2: Seeding WMS entities...");
    const region = config.collectionPrep?.region || "CA";
    let collectionPrepId: string | undefined;

    // Create collection prep first if configured (needed for linking)
    if (config.collectionPrep) {
      console.log("📋 Creating collection prep...");
      const collectionPrepRequest = {
        orderIds: shopifyResult.shopifyOrders.map((o) => o.shopifyOrderId),
        carrier: config.collectionPrep.carrier,
        locationId: config.collectionPrep.locationId,
        region: config.collectionPrep.region,
        prepDate: config.collectionPrep.prepDate,
      };

      const collectionPrepResult = await createCollectionPrepHandler.execute(collectionPrepRequest);
      collectionPrepId = collectionPrepResult.collectionPrepId;
      console.log(`✅ Created collection prep: ${collectionPrepId}\n`);
    }

    // Seed WMS entities with Shopify order data
    // Map Shopify orders back to config to get customer info and quantities
    const wmsRequest = {
      shopifyOrders: shopifyResult.shopifyOrders.map((shopifyOrder, index) => {
        const configOrder = config.orders[index];
        // Match line items by SKU to get quantities from config
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
          status: "fulfilled", // Orders are fulfilled in Shopify
          customerName: configOrder.customer.name,
          customerEmail: configOrder.customer.email,
          lineItems: lineItemsWithQuantity,
        };
      }),
      collectionPrepId,
      region,
    };

    const wmsResult = await seedWmsEntitiesHandler.execute(wmsRequest);
    console.log(`✅ Created ${wmsResult.orders.length} WMS order(s)`);
    console.log(`✅ Created ${wmsResult.shipments.length} shipment(s)\n`);

    // Display summary
    const collectionPrepResult = collectionPrepId
      ? { collectionPrepId, region: config.collectionPrep!.region }
      : undefined;
    displaySummary(shopifyResult, wmsResult, collectionPrepResult);

    // Cleanup
    await prisma.$disconnect();
  } catch (error) {
    console.error("\n❌ Seeding failed:");
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if (error.stack && process.env.NODE_ENV === "development") {
        console.error(`\nStack trace:\n${error.stack}`);
      }
    } else {
      console.error(`   ${String(error)}`);
    }
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
