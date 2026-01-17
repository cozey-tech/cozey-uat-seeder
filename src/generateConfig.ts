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
import { ConfigDataRepository, type Carrier, type Customer, type Variant } from "./repositories/ConfigDataRepository";
import { InteractivePromptService } from "./services/InteractivePromptService";
import { OrderCompositionBuilder, type OrderComposition } from "./services/OrderCompositionBuilder";
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

      // Prompt for order creation mode
      const creationMode = await promptService.promptOrderCreationMode();

      // Build orders based on mode
      const orders = [];
      let inventoryChecks: Array<{
        orderIndex: number;
        composition: OrderComposition;
        customer: Customer;
        locationId: string;
      }> = [];

      if (creationMode === "individual") {
        // Individual mode: original flow
        const orderCount = await promptService.promptOrderCount();
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

        // Defer inventory check for bulk operations
        if (options.modifyInventory) {
          inventoryChecks.push({
            orderIndex: orders.length,
            composition,
            customer,
            locationId: customer.locationId,
          });
        }

        orders.push({
          customer,
          composition,
          locationId: customer.locationId,
        });
        }
      } else if (creationMode === "bulk-template") {
        // Bulk template mode
        if (templates.length === 0) {
          throw new Error("No templates available. Please create a template first or use individual mode.");
        }

        const template = await promptService.promptTemplateSelection(templates);
        const bulkCount = await promptService.promptBulkOrderCount(50);
        const { customer: baseCustomer, useSameForAll } = await promptService.promptBulkCustomerSelection(
          customers,
          true,
        );

        console.log(`\n📦 Creating ${bulkCount} orders from template "${template.name}"...`);

        // Create variant map for pickType lookup
        const variantMap = new Map<string, Variant>();
        for (const variant of variants) {
          variantMap.set(variant.sku, variant);
        }

        for (let i = 0; i < bulkCount; i++) {
          // Select customer (if not using same for all)
          const customer = useSameForAll
            ? baseCustomer
            : await promptService.promptCustomerSelection(customers);

          // Build composition from template
          const lineItems = template.lineItems.map((item) => {
            const variant = variantMap.get(item.sku);
            if (!variant) {
              throw new Error(`Variant not found for SKU ${item.sku} in template`);
            }
            return {
              sku: item.sku,
              quantity: item.quantity,
              pickType: variant.pickType,
            };
          });

          const composition: OrderComposition = { lineItems };

          if (options.modifyInventory) {
            inventoryChecks.push({
              orderIndex: orders.length,
              composition,
              customer,
              locationId: customer.locationId,
            });
          }

          orders.push({
            customer,
            composition,
            locationId: customer.locationId,
          });

          if ((i + 1) % 10 === 0) {
            console.log(`   ✓ Created ${i + 1} of ${bulkCount} orders...`);
          }
        }

        console.log(`✅ Created ${bulkCount} orders from template\n`);
      } else if (creationMode === "quick-duplicate") {
        // Quick duplicate mode: create first order, then duplicate with edits
        console.log("\n📦 Create your first order (this will be used as a template):");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // Create first order
        const firstCustomer = await promptService.promptCustomerSelection(customers);
        const firstLocation = await dataRepository.getLocationForCustomer(firstCustomer);
        if (!firstLocation) {
          throw new Error(`Location not found for customer ${firstCustomer.id}`);
        }

        const firstCompositionType = await promptService.promptOrderComposition(variants, templates);
        let firstComposition: OrderComposition;
        if (firstCompositionType === "template") {
          const template = await promptService.promptTemplateSelection(templates);
          firstComposition = await compositionBuilder.buildFromTemplate(template, variants);
        } else {
          firstComposition = await compositionBuilder.buildCustom(variants);
        }

        if (options.modifyInventory) {
          inventoryChecks.push({
            orderIndex: orders.length,
            composition: firstComposition,
            customer: firstCustomer,
            locationId: firstCustomer.locationId,
          });
        }

        orders.push({
          customer: firstCustomer,
          composition: firstComposition,
          locationId: firstCustomer.locationId,
        });

        console.log("✅ First order created\n");

        // Duplicate and edit
        let duplicateMore = true;
        while (duplicateMore) {
          const shouldDuplicate = await promptService.promptConfirm(
            "Would you like to duplicate this order with edits?",
            true,
          );

          if (!shouldDuplicate) {
            duplicateMore = false;
            break;
          }

          const duplicateCustomer = await promptService.promptCustomerSelection(customers);
          const duplicateLocation = await dataRepository.getLocationForCustomer(duplicateCustomer);
          if (!duplicateLocation) {
            throw new Error(`Location not found for customer ${duplicateCustomer.id}`);
          }

          // Allow editing the composition
          const shouldEdit = await promptService.promptConfirm(
            "Would you like to edit the order composition?",
            false,
          );

          let duplicateComposition: OrderComposition;
          if (shouldEdit) {
            // Rebuild from template or custom
            const editCompositionType = await promptService.promptOrderComposition(variants, templates);
            if (editCompositionType === "template") {
              const template = await promptService.promptTemplateSelection(templates);
              duplicateComposition = await compositionBuilder.buildFromTemplate(template, variants);
            } else {
              duplicateComposition = await compositionBuilder.buildCustom(variants);
            }
          } else {
            // Use same composition
            duplicateComposition = { ...firstComposition };
          }

          if (options.modifyInventory) {
            inventoryChecks.push({
              orderIndex: orders.length,
              composition: duplicateComposition,
              customer: duplicateCustomer,
              locationId: duplicateCustomer.locationId,
            });
          }

          orders.push({
            customer: duplicateCustomer,
            composition: duplicateComposition,
            locationId: duplicateCustomer.locationId,
          });

          console.log(`✅ Duplicated order (${orders.length} total)\n`);
        }
      }

      // Batch inventory checks at the end (if enabled)
      if (options.modifyInventory && inventoryChecks.length > 0) {
        console.log("\n🔍 Checking inventory for all orders...");
        for (const check of inventoryChecks) {
          const compositionSkus = check.composition.lineItems.map((item) => item.sku);
          const compositionVariants = variants.filter((v) => compositionSkus.includes(v.sku));

          const variantQuantities = new Map<string, number>();
          for (const item of check.composition.lineItems) {
            const existingQuantity = variantQuantities.get(item.sku) || 0;
            variantQuantities.set(item.sku, existingQuantity + item.quantity);
          }

          const inventoryCheck = await inventoryService.checkInventoryAvailability(
            compositionVariants,
            check.locationId,
            region,
            variantQuantities,
          );

          if (!inventoryCheck.sufficient) {
            console.log(`\n⚠️  Order ${check.orderIndex + 1} has inventory shortages:`);
            const shouldModify = await promptService.promptInventoryModification(inventoryCheck);
            if (shouldModify) {
              await inventoryService.ensureInventoryForOrder(
                check.composition,
                check.locationId,
                region,
              );
              console.log(`✅ Inventory updated for order ${check.orderIndex + 1}`);
            }
          }
        }
        console.log("✅ Inventory checks complete\n");
      }

      // Order review step
      let reviewComplete = false;
      while (!reviewComplete) {
        const reviewAction = await promptService.promptOrderReviewAction(orders);

        if (reviewAction === "continue") {
          reviewComplete = true;
        } else if (reviewAction === "add-more") {
          // Add more orders using the same creation mode
          console.log("\n📦 Adding more orders...");
          // Reuse the creation mode logic (simplified - just add one more order)
          const customer = await promptService.promptCustomerSelection(customers);
          const location = await dataRepository.getLocationForCustomer(customer);
          if (!location) {
            throw new Error(`Location not found for customer ${customer.id}`);
          }

          const compositionType = await promptService.promptOrderComposition(variants, templates);
          let composition: OrderComposition;
          if (compositionType === "template") {
            const template = await promptService.promptTemplateSelection(templates);
            composition = await compositionBuilder.buildFromTemplate(template, variants);
          } else {
            composition = await compositionBuilder.buildCustom(variants);
          }

          if (options.modifyInventory) {
            inventoryChecks.push({
              orderIndex: orders.length,
              composition,
              customer,
              locationId: customer.locationId,
            });
          }

          orders.push({
            customer,
            composition,
            locationId: customer.locationId,
          });
          console.log(`✅ Added order ${orders.length}\n`);
        } else if (reviewAction === "edit") {
          if (orders.length === 0) {
            console.log("⚠️  No orders to edit.\n");
            continue;
          }
          const orderIndex = await promptService.promptOrderToEdit(orders.length);
          console.log(`\n📝 Editing Order ${orderIndex + 1}...`);

          // Rebuild the order
          const customer = await promptService.promptCustomerSelection(customers);
          const location = await dataRepository.getLocationForCustomer(customer);
          if (!location) {
            throw new Error(`Location not found for customer ${customer.id}`);
          }

          const compositionType = await promptService.promptOrderComposition(variants, templates);
          let composition: OrderComposition;
          if (compositionType === "template") {
            const template = await promptService.promptTemplateSelection(templates);
            composition = await compositionBuilder.buildFromTemplate(template, variants);
          } else {
            composition = await compositionBuilder.buildCustom(variants);
          }

          // Update inventory check if needed
          if (options.modifyInventory) {
            // Remove old check, add new one
            inventoryChecks = inventoryChecks.filter((check) => check.orderIndex !== orderIndex);
            inventoryChecks.push({
              orderIndex,
              composition,
              customer,
              locationId: customer.locationId,
            });
          }

          orders[orderIndex] = {
            customer,
            composition,
            locationId: customer.locationId,
          };
          console.log(`✅ Updated order ${orderIndex + 1}\n`);
        } else if (reviewAction === "delete") {
          if (orders.length === 0) {
            console.log("⚠️  No orders to delete.\n");
            continue;
          }
          if (orders.length === 1) {
            console.log("⚠️  Cannot delete the last order. Please add more orders first.\n");
            continue;
          }
          const orderIndex = await promptService.promptOrderToDelete(orders.length);
          const confirmDelete = await promptService.promptConfirm(
            `Are you sure you want to delete Order ${orderIndex + 1}?`,
            false,
          );

          if (confirmDelete) {
            orders.splice(orderIndex, 1);
            // Update inventory check indices
            if (options.modifyInventory) {
              inventoryChecks = inventoryChecks
                .filter((check) => check.orderIndex !== orderIndex)
                .map((check) => ({
                  ...check,
                  orderIndex: check.orderIndex > orderIndex ? check.orderIndex - 1 : check.orderIndex,
                }));
            }
            console.log(`✅ Deleted order ${orderIndex + 1}\n`);
          }
        } else if (reviewAction === "start-over") {
          const confirmStartOver = await promptService.promptConfirm(
            "Are you sure you want to start over? All current orders will be lost.",
            false,
          );

          if (confirmStartOver) {
            orders.length = 0;
            inventoryChecks.length = 0;
            console.log("🔄 Starting over...\n");
            // Exit and let user restart manually
            console.log("Please run the command again to start over.");
            process.exit(0);
          }
        }
      }

      // Prompt for collection prep
      console.log("\n📋 Collection Prep Configuration");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      let collectionPreps: Array<{
        carrier: Carrier;
        locationId: string;
        prepDate: Date;
        testTag?: string;
        orderIndices?: number[];
      }> | undefined;
      let collectionPrepCount: number | undefined;
      let carrier: Carrier | undefined;
      let prepDate: Date | undefined;
      let testTag: string | undefined;

      if (carriers.length === 0) {
        console.warn("⚠️  No carriers available. Skipping collection prep configuration.\n");
      } else {
        const builderMode = await promptService.promptCollectionPrepBuilderMode();

        if (builderMode === "bulk") {
          // Bulk collection prep creation mode
          const bulkConfig = await promptService.promptBulkCollectionPrepConfig(
            carriers,
            orders.length,
          );

          // Get locationId from orders (validate all orders have same location)
          const locationIds = new Set(orders.map((o) => o.locationId).filter(Boolean));
          if (locationIds.size > 1) {
            throw new Error(
              `Cannot create collection prep: orders have different locationIds: ${Array.from(locationIds).join(", ")}. ` +
                `All orders must have the same locationId for collection prep.`,
            );
          }
          const locationId = orders[0]?.locationId || "";
          if (!locationId) {
            throw new Error("Cannot create collection prep: no locationId found in orders");
          }

          // Create collection preps with auto-allocated orders
          collectionPreps = [];
          for (let i = 0; i < bulkConfig.count; i++) {
            // Round-robin order allocation
            const orderIndices: number[] = [];
            for (let j = i; j < orders.length; j += bulkConfig.count) {
              orderIndices.push(j);
            }

            collectionPreps.push({
              carrier: bulkConfig.carriers[i],
              locationId,
              prepDate: new Date(),
              testTag: bulkConfig.baseTestTag,
              orderIndices,
            });
          }

          // Show allocation summary
          console.log("\n📊 Bulk Collection Prep Summary:");
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          for (let i = 0; i < collectionPreps.length; i++) {
            const prep = collectionPreps[i];
            const orderList = prep.orderIndices
              ? prep.orderIndices.map((idx) => idx + 1).join(", ")
              : "None";
            console.log(
              `   Prep ${i + 1}: ${prep.carrier.name} - Orders: ${orderList} (${prep.orderIndices?.length || 0} orders)`,
            );
          }
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } else if (builderMode === "multiple") {
          // Collection prep builder: configure multiple preps
          collectionPreps = [];
          let addMore = true;
          let prepNumber = 1;

          // Get locationId from orders (validate all orders have same location for now)
          const locationIds = new Set(orders.map((o) => o.locationId).filter(Boolean));
          if (locationIds.size > 1) {
            throw new Error(
              `Cannot create collection prep: orders have different locationIds: ${Array.from(locationIds).join(", ")}. ` +
                `All orders must have the same locationId for collection prep.`,
            );
          }
          const locationId = orders[0]?.locationId || "";
          if (!locationId) {
            throw new Error("Cannot create collection prep: no locationId found in orders");
          }

          while (addMore) {
            const prepConfig = await promptService.promptCollectionPrepConfig(
              prepNumber,
              collectionPreps.length + 1,
              carriers,
              orders.length,
            );

            collectionPreps.push({
              carrier: prepConfig.carrier,
              locationId,
              prepDate: new Date(),
              testTag: prepConfig.testTag,
              orderIndices: prepConfig.orderIndices,
            });

            prepNumber++;
            addMore = await promptService.promptAddAnotherCollectionPrep();
          }

          // Show allocation summary
          console.log("\n📊 Collection Prep Allocation Summary:");
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          for (let i = 0; i < collectionPreps.length; i++) {
            const prep = collectionPreps[i];
            const orderList = prep.orderIndices
              ? prep.orderIndices.map((idx) => idx + 1).join(", ")
              : "None";
            console.log(
              `   Prep ${i + 1}: ${prep.carrier.name} - Orders: ${orderList} (${prep.orderIndices?.length || 0} orders)`,
            );
          }
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } else {
          // Legacy single collection prep mode
          collectionPrepCount = await promptService.promptCollectionPrepCount(orders.length, carriers.length > 0);

          if (collectionPrepCount > 0) {
            carrier = await promptService.promptCarrierSelection(carriers);
            prepDate = new Date();
            testTag = await promptService.promptTestTag();
          }
        }
      }

      // Generate config
      console.log("\n⚙️  Generating configuration...");
      const config = await generatorService.generateConfig({
        orders,
        collectionPreps,
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
        const defaultPath = options.output || "output/seed-config.json";
        const outputPath = options.output || (await promptService.promptSaveLocation(defaultPath));
        
        // Ensure output directory exists
        const outputDir = dirname(outputPath);
        if (!existsSync(outputDir)) {
          const { mkdirSync } = await import("fs");
          mkdirSync(outputDir, { recursive: true });
        }
        
        writeFileSync(outputPath, JSON.stringify(config, null, 2), "utf-8");
        console.log(`\n✅ Configuration saved to: ${outputPath}`);
      }

      // Display summary
      console.log("\n✅ Config Generation Complete!");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`📦 Orders: ${config.orders.length}`);
      if (config.collectionPreps && config.collectionPreps.length > 0) {
        console.log(`📋 Collection Preps: ${config.collectionPreps.length}`);
        for (let i = 0; i < config.collectionPreps.length; i++) {
          const prep = config.collectionPreps[i];
          console.log(`   Prep ${i + 1}: ${prep.carrier} at ${prep.locationId}`);
        }
      } else if (config.collectionPrep) {
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
