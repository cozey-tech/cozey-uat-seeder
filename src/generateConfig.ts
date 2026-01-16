#!/usr/bin/env node

/**
 * CLI Entry Point for Interactive Config Generator
 *
 * Guides users through creating seed configuration JSON files by:
 * 1. Asking interactive questions
 * 2. Fetching data from database/API
 * 3. Generating properly structured config files
 * 4. Validating output before saving
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env first, then .env.local (which will override .env values)
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

import { PrismaClient } from "@prisma/client";
import { writeFileSync, existsSync, accessSync, constants } from "fs";
import { ConfigDataRepository } from "./repositories/ConfigDataRepository";
import { InteractivePromptService } from "./services/InteractivePromptService";
import { OrderCompositionBuilder } from "./services/OrderCompositionBuilder";
import { ConfigGeneratorService } from "./services/ConfigGeneratorService";
import { ConfigValidationService } from "./services/ConfigValidationService";
import { InventoryService } from "./services/InventoryService";
import { DataValidationService } from "./services/DataValidationService";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import type { OrderTemplate } from "./services/InteractivePromptService";

interface CliOptions {
  dryRun: boolean;
  output?: string;
  region?: "CA" | "US";
  modifyInventory: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    dryRun: args.includes("--dry-run"),
    modifyInventory: args.includes("--modify-inventory"),
  };

  // Parse --output
  const outputIndex = args.indexOf("--output");
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    options.output = args[outputIndex + 1];
  }

  // Parse --region
  const regionIndex = args.indexOf("--region");
  if (regionIndex !== -1 && args[regionIndex + 1]) {
    const region = args[regionIndex + 1] as "CA" | "US";
    if (region === "CA" || region === "US") {
      options.region = region;
    } else {
      throw new Error(
        `Invalid region: ${region}. Must be "CA" or "US". Use --region CA or --region US`,
      );
    }
  }

  // Validate --output path if provided
  if (options.output) {
    const parentDir = dirname(options.output);
    if (!existsSync(parentDir)) {
      throw new Error(
        `Output directory does not exist: ${parentDir}. Please create it first or use a different path.`,
      );
    }

    // Check if parent directory is writable
    try {
      accessSync(parentDir, constants.W_OK);
    } catch {
      throw new Error(
        `Output directory is not writable: ${parentDir}. Please check permissions.`,
      );
    }
  }

  return options;
}

/**
 * Load order templates from config file
 */
function loadOrderTemplates(): OrderTemplate[] {
  try {
    const configPath = join(process.cwd(), "config", "orderTemplates.json");
    const fileContent = readFileSync(configPath, "utf-8");
    const config = JSON.parse(fileContent);
    return config.templates || [];
  } catch {
    console.warn("⚠️  Could not load order templates, continuing without them");
    return [];
  }
}

/**
 * Filter templates to only include those with valid SKUs for the given variants
 */
function filterValidTemplates(
  templates: OrderTemplate[],
  variants: Array<{ sku: string }>,
): OrderTemplate[] {
  const validSkus = new Set(variants.map((v) => v.sku));
  
  const validTemplates = templates.filter((template) => {
    // Check if all SKUs in template exist in available variants
    return template.lineItems.every((item) => validSkus.has(item.sku));
  });

  const invalidCount = templates.length - validTemplates.length;
  if (invalidCount > 0) {
    console.warn(
      `⚠️  Filtered out ${invalidCount} template(s) with invalid SKUs for this region`,
    );
  }

  return validTemplates;
}

/**
 * Main orchestrator function
 */
async function main(): Promise<void> {
  try {
    // Parse CLI arguments
    const options = parseArgs();

    console.log("🚀 Interactive Config Generator");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if (options.dryRun) {
      console.log("🔍 DRY RUN MODE - No files will be saved\n");
    }

    // Initialize Prisma
    const prisma = new PrismaClient();

    try {
      // Initialize services
      const dataRepository = new ConfigDataRepository(prisma);
      const promptService = new InteractivePromptService();
      const compositionBuilder = new OrderCompositionBuilder(promptService);
      const generatorService = new ConfigGeneratorService(prisma);
      const dataValidationService = new DataValidationService(prisma);
      const validationService = new ConfigValidationService(
        prisma,
        dataRepository,
        dataValidationService,
      );
      const inventoryService = new InventoryService(prisma);

      // Prompt for region if not provided
      const region = options.region || (await promptService.promptRegion());

      // Load reference data
      console.log("📊 Loading reference data...");
      const [variants, customers, carriers, allTemplates] = await Promise.all([
        dataRepository.getAvailableVariants(region),
        dataRepository.getCustomers(),
        dataRepository.getCarriers(region),
        Promise.resolve(loadOrderTemplates()),
      ]);

      // Filter templates to only include those with valid SKUs for this region
      const templates = filterValidTemplates(allTemplates, variants);

      console.log(`   ✓ Found ${variants.length} variants`);
      console.log(`   ✓ Found ${customers.length} customers`);
      console.log(`   ✓ Found ${carriers.length} carriers`);
      console.log(`   ✓ Found ${templates.length} valid template(s)${templates.length !== allTemplates.length ? ` (${allTemplates.length - templates.length} filtered out)` : ""}\n`);

      // Validate reference data is not empty
      if (variants.length === 0) {
        throw new Error(`No variants found for region ${region}. Please check database.`);
      }
      if (customers.length === 0) {
        throw new Error(
          "No customers found in config/customers.json. Please add at least one customer.",
        );
      }
      if (carriers.length === 0) {
        throw new Error(`No carriers found for region ${region}. Please check database or config.`);
      }

      // Prompt for number of orders
      const orderCount = await promptService.promptOrderCount();

      // Build orders
      const orders = [];
      for (let i = 0; i < orderCount; i++) {
        console.log(`\n📦 Building Order ${i + 1} of ${orderCount}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // Select customer
        const customer = await promptService.promptCustomerSelection(customers);
        const location = await dataRepository.getLocationForCustomer(customer);
        if (!location) {
          throw new Error(`Location not found for customer ${customer.id}`);
        }

        // Select order composition method (automatically uses custom if no templates available)
        const compositionType = await promptService.promptOrderComposition(variants, templates);

        let composition;
        if (compositionType === "template") {
          const template = await promptService.promptTemplateSelection(templates);
          composition = await compositionBuilder.buildFromTemplate(template, variants);
        } else {
          // Build custom order
          composition = await compositionBuilder.buildCustom(variants);
        }

        // Check inventory if enabled
        if (options.modifyInventory) {
          // Get variants for the actual SKUs in composition
          const compositionSkus = composition.lineItems.map((item) => item.sku);
          const compositionVariants = variants.filter((v) => compositionSkus.includes(v.sku));
          
          // Create map of SKU to quantity (sum quantities for duplicate SKUs)
          const variantQuantities = new Map<string, number>();
          for (const item of composition.lineItems) {
            const existingQuantity = variantQuantities.get(item.sku) || 0;
            variantQuantities.set(item.sku, existingQuantity + item.quantity);
          }

          const inventoryCheck = await inventoryService.checkInventoryAvailability(
            compositionVariants,
            customer.locationId,
            region,
            variantQuantities,
          );

          if (!inventoryCheck.sufficient) {
            const shouldModify = await promptService.promptInventoryModification(inventoryCheck);
            if (shouldModify) {
              await inventoryService.ensureInventoryForOrder(
                composition,
                customer.locationId,
                region,
              );
              console.log("✅ Inventory updated");
            }
          }
        }

        orders.push({
          customer,
          composition,
          locationId: customer.locationId,
        });
      }

      // Prompt for collection prep
      console.log("\n📋 Collection Prep Configuration");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      const collectionPrepCount = await promptService.promptCollectionPrepCount(orderCount);
      const carrier = await promptService.promptCarrierSelection(carriers);
      const prepDate = new Date();

      // Generate config
      console.log("\n⚙️  Generating configuration...");
      const config = await generatorService.generateConfig({
        orders,
        collectionPrepCount,
        carrier,
        prepDate,
        region,
      });

      // Validate config
      console.log("✅ Validating configuration...");
      const validationResult = await validationService.validateFull(config);

      if (!validationResult.valid) {
        console.error("\n❌ Validation failed:");
        validationResult.errors.forEach((error) => {
          console.error(`   - ${error}`);
        });
        process.exit(1);
      }

      if (validationResult.warnings.length > 0) {
        console.warn("\n⚠️  Validation warnings:");
        validationResult.warnings.forEach((warning) => {
          console.warn(`   - ${warning}`);
        });
      }

      // Save or preview
      if (options.dryRun) {
        console.log("\n📄 Generated Config (Preview):");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(JSON.stringify(config, null, 2));
      } else {
        const outputPath =
          options.output || (await promptService.promptSaveLocation("seed-config.json"));
        writeFileSync(outputPath, JSON.stringify(config, null, 2), "utf-8");
        console.log(`\n✅ Configuration saved to: ${outputPath}`);
      }

      // Display summary
      console.log("\n✅ Config Generation Complete!");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`📦 Orders: ${config.orders.length}`);
      if (config.collectionPrep) {
        console.log(`📋 Collection Prep: ${config.collectionPrep.carrier} at ${config.collectionPrep.locationId}`);
      }
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n❌ Error: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error("\n❌ Unknown error:", error);
    }
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
