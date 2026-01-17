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
import { ConfigDataRepository, type Carrier } from "./repositories/ConfigDataRepository";
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
  skipSaveTemplate: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    dryRun: args.includes("--dry-run"),
    modifyInventory: args.includes("--modify-inventory"),
    skipSaveTemplate: args.includes("--skip-save-template"),
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
 * Save a new template to the order templates file
 * Creates the file structure if it doesn't exist
 */
function saveTemplate(template: OrderTemplate): void {
  try {
    const configPath = join(process.cwd(), "config", "orderTemplates.json");
    
    // Read existing config or create new structure
    let config: { templates: OrderTemplate[] };
    try {
      const fileContent = readFileSync(configPath, "utf-8");
      config = JSON.parse(fileContent);
      // Ensure templates array exists
      if (!config.templates || !Array.isArray(config.templates)) {
        config.templates = [];
      }
    } catch {
      // File doesn't exist or is invalid - create new structure
      config = { templates: [] };
    }
    
    // Check if template with same ID already exists
    const existingIndex = config.templates.findIndex((t: OrderTemplate) => t.id === template.id);
    if (existingIndex !== -1) {
      // Update existing template
      config.templates[existingIndex] = template;
      console.log(`✅ Updated existing template: ${template.name} (${template.id})`);
    } else {
      // Add new template
      config.templates.push(template);
      console.log(`✅ Saved new template: ${template.name} (${template.id})`);
    }
    
    // Write back to file
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    throw new Error(`Failed to save template: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Filter templates to only include those with valid SKUs for the given variants
 * Note: pickType in templates is informational only - the variant's pickType from the database will always be used
 */
function filterValidTemplates(
  templates: OrderTemplate[],
  variants: Array<{ sku: string; pickType: "Regular" | "Pick and Pack" }>,
): OrderTemplate[] {
  // Create a set of valid SKUs for quick lookup
  const validSkus = new Set(variants.map((v) => v.sku));
  
  const validTemplates: OrderTemplate[] = [];
  const invalidTemplates: Array<{ template: OrderTemplate; reasons: string[] }> = [];

  for (const template of templates) {
    const reasons: string[] = [];
    
    // Check each line item in the template
    for (const item of template.lineItems) {
      if (!validSkus.has(item.sku)) {
        reasons.push(`SKU "${item.sku}" not found in database for this region`);
      }
    }

    if (reasons.length === 0) {
      validTemplates.push(template);
    } else {
      invalidTemplates.push({ template, reasons });
    }
  }

  // Report invalid templates with detailed error messages
  if (invalidTemplates.length > 0) {
    console.warn(`\n⚠️  Filtered out ${invalidTemplates.length} invalid template(s):`);
    for (const { template, reasons } of invalidTemplates) {
      console.warn(`   ❌ Template "${template.name}" (${template.id}):`);
      for (const reason of reasons) {
        console.warn(`      - ${reason}`);
      }
    }
    console.warn("");
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
      let [variants, customers, carriers, allTemplates] = await Promise.all([
        dataRepository.getAvailableVariants(region),
        dataRepository.getCustomers(region),
        dataRepository.getCarriers(region),
        Promise.resolve(loadOrderTemplates()),
      ]);

      // Filter templates to only include those with valid SKUs for this region
      let templates = filterValidTemplates(allTemplates, variants);

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
        console.warn(
          `⚠️  No carriers found for region ${region}. Collection prep will be skipped.`,
        );
        console.warn(
          `   To enable collection prep, add carriers to the database for region ${region}.\n`,
        );
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
          
          // Offer to save custom order as template (unless skipped)
          if (!options.skipSaveTemplate) {
            const shouldSave = await promptService.promptConfirm(
              "Would you like to save this order as a template for future use?",
              false,
            );
            
            if (shouldSave) {
              console.log("\n💾 Saving order as template...");
              const templateName = await promptService.promptTemplateName();
              const templateDescription = await promptService.promptTemplateDescription();
              
              // Generate suggested ID from name
              const suggestedId = templateName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
              
              const templateId = await promptService.promptTemplateId(suggestedId);
              
              // Create template from composition
              const newTemplate: OrderTemplate = {
                id: templateId,
                name: templateName,
                description: templateDescription || `Custom order: ${templateName}`,
                lineItems: composition.lineItems.map((item) => ({
                  sku: item.sku,
                  quantity: item.quantity,
                  pickType: item.pickType, // Informational only - will use variant's pickType when used
                })),
              };
              
              saveTemplate(newTemplate);
              
              // Reload templates to include the new one
              const updatedTemplates = loadOrderTemplates();
              const validUpdatedTemplates = filterValidTemplates(updatedTemplates, variants);
              templates = validUpdatedTemplates;
              allTemplates = updatedTemplates;
            }
          }
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
      const collectionPrepCount = await promptService.promptCollectionPrepCount(orderCount, carriers.length > 0);
      
      // Only require carriers if collection prep is requested
      if (collectionPrepCount > 0 && carriers.length === 0) {
        throw new Error(
          `Cannot create collection prep: No carriers found for region ${region}.\n` +
            `Please add carriers to the database or set collection prep count to 0 to skip collection prep.`,
        );
      }

      let carrier: Carrier | undefined;
      let prepDate: Date | undefined;
      let testTag: string | undefined;
      if (collectionPrepCount > 0) {
        carrier = await promptService.promptCarrierSelection(carriers);
        prepDate = new Date();
        testTag = await promptService.promptTestTag();
      }

      // Generate config
      console.log("\n⚙️  Generating configuration...");
      const config = await generatorService.generateConfig({
        orders,
        collectionPrepCount,
        carrier,
        prepDate,
        region,
        testTag,
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
