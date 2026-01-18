#!/usr/bin/env node

/**
 * CLI Entry Point for Interactive Config Generator
 *
 * Guides users through creating seed configuration JSON files via
 * interactive prompts, database queries, and validation before saving.
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

import { PrismaClient } from "@prisma/client";
import { parseArgs } from "./generateConfig/args";
import { loadReferenceData } from "./generateConfig/initialization";
import { createOrders } from "./generateConfig/flow/orderCreation";
import { reviewOrders } from "./generateConfig/flow/review";
import { configureCollectionPreps } from "./generateConfig/flow/collectionPrep";
import { saveOrPreviewConfig, displayPerformanceSummary } from "./generateConfig/output";
import { ConfigDataRepository } from "./repositories/ConfigDataRepository";
import { InteractivePromptService } from "./services/InteractivePromptService";
import { OrderCompositionBuilder } from "./services/OrderCompositionBuilder";
import { ConfigGeneratorService } from "./services/ConfigGeneratorService";
import { ConfigValidationService } from "./services/ConfigValidationService";
import { DataValidationService } from "./services/DataValidationService";
import { InventoryService } from "./services/InventoryService";
import { OutputFormatter } from "./utils/outputFormatter";
import { ErrorFormatter } from "./utils/errorFormatter";
import { Logger } from "./utils/logger";
import { getValidationSummary } from "./generateConfig/flow/validation";

/**
 * Main orchestrator function
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  const performanceMetrics = {
    totalTime: 0,
    referenceDataLoadTime: 0,
    orderCreationTime: 0,
    collectionPrepTime: 0,
    validationTime: 0,
    orderCount: 0,
    collectionPrepCount: 0,
    parallelOperations: 0,
  };

  try {
    const options = parseArgs();

    console.log(OutputFormatter.header("Interactive Config Generator", "🚀"));
    console.log(OutputFormatter.separator());
    console.log();

    if (options.dryRun) {
      console.log(OutputFormatter.header("DRY RUN MODE - No files will be saved", "🔍"));
      console.log();
    }

    const prisma = new PrismaClient();

    try {
      // Initialize services
      const dataRepository = new ConfigDataRepository(prisma);
      const promptService = new InteractivePromptService();
      const compositionBuilder = new OrderCompositionBuilder(promptService);
      const generatorService = new ConfigGeneratorService(prisma);
      const dataValidationService = new DataValidationService(prisma);
      const validationService = new ConfigValidationService(prisma, dataRepository, dataValidationService);
      const inventoryService = new InventoryService(prisma);

      // Prompt for region if not provided
      const region = options.region || (await promptService.promptRegion());

      // Load reference data
      const { data: referenceData, loadTime } = await loadReferenceData(dataRepository, region);
      performanceMetrics.referenceDataLoadTime = loadTime;

      let { variants, customers, carriers, templates, locationsCache } = referenceData;

      // Create orders
      const orderCreationStart = Date.now();
      const orderCreationResult = await createOrders(
        {
          variants,
          customers,
          templates,
          locationsCache,
          region,
          promptService,
          compositionBuilder,
          inventoryService,
        },
        {
          modifyInventory: options.modifyInventory,
          skipSaveTemplate: options.skipSaveTemplate,
        },
      );

      // Update templates if new ones were saved
      if (orderCreationResult.updatedTemplates) {
        templates = orderCreationResult.updatedTemplates;
      }

      let { orders, inventoryChecks } = orderCreationResult;
      performanceMetrics.orderCreationTime = Date.now() - orderCreationStart;

      // Review orders
      const reviewResult = await reviewOrders(
        orders,
        inventoryChecks,
        {
          variants,
          customers,
          templates,
          locationsCache,
          promptService,
          compositionBuilder,
        },
        {
          modifyInventory: options.modifyInventory,
        },
      );
      orders = reviewResult.orders;
      inventoryChecks = reviewResult.inventoryChecks;

      // Configure collection preps
      const collectionPrepResult = await configureCollectionPreps({
        carriers,
        orders,
        promptService,
      });

      performanceMetrics.orderCount = orders.length;

      // Generate config
      const configGenStart = Date.now();
      console.log();
      console.log(OutputFormatter.info("Generating configuration..."));
      const seedConfig = await generatorService.generateConfig({
        orders,
        collectionPreps: collectionPrepResult.collectionPreps,
        collectionPrepCount: collectionPrepResult.collectionPrepCount,
        carrier: collectionPrepResult.carrier,
        prepDate: collectionPrepResult.prepDate,
        region,
        testTag: collectionPrepResult.testTag,
      });

      performanceMetrics.collectionPrepCount =
        seedConfig.collectionPreps?.length || (seedConfig.collectionPrep ? 1 : 0);
      if (seedConfig.collectionPreps && seedConfig.collectionPreps.length > 1) {
        performanceMetrics.parallelOperations = seedConfig.collectionPreps.length;
      }
      const configGenTime = Date.now() - configGenStart;
      performanceMetrics.collectionPrepTime = configGenTime;

      // Validate config
      const validationStart = Date.now();
      const validationOperationId = Logger.startOperation("validateConfig", {
        orderCount: seedConfig.orders.length,
        hasCollectionPrep: !!seedConfig.collectionPrep || (seedConfig.collectionPreps?.length ?? 0) > 0,
      });

      console.log(OutputFormatter.info("Validating configuration..."));

      // Get incremental validation summary
      const incrementalValidation = getValidationSummary(
        orders.map((o) => ({ composition: o.composition })),
        variants,
      );

      if (incrementalValidation.errorCount > 0) {
        console.error();
        console.error(OutputFormatter.error("Incremental validation found errors:"));
        for (const issue of incrementalValidation.issues.filter((i) => i.type === "error")) {
          const prefix = issue.orderIndex !== undefined ? `Order ${issue.orderIndex + 1}: ` : "";
          console.error(OutputFormatter.listItem(`${prefix}${issue.message}`));
        }
        Logger.error("Config has validation errors from incremental validation", {
          errorCount: incrementalValidation.errorCount,
          warningCount: incrementalValidation.warningCount,
        });
      }

      const validationResult = await validationService.validateFull(seedConfig);
      performanceMetrics.validationTime = Date.now() - validationStart;

      Logger.endOperation(validationOperationId, validationResult.valid, {
        errorCount: validationResult.errors.length,
        warningCount: validationResult.warnings.length,
      });

      if (!validationResult.valid) {
        console.error();
        console.error(OutputFormatter.error("Final validation failed:"));
        for (const error of validationResult.errors) {
          console.error(OutputFormatter.listItem(error));
        }
        Logger.error("Config validation failed", {
          errors: validationResult.errors,
          warnings: validationResult.warnings,
        });
        process.exit(1);
      }

      if (validationResult.warnings.length > 0) {
        console.warn();
        console.warn(OutputFormatter.warning("Validation warnings:"));
        for (const warning of validationResult.warnings) {
          console.warn(OutputFormatter.listItem(warning));
        }
        Logger.warn("Config has validation warnings", {
          warningCount: validationResult.warnings.length,
        });
      }

      // Prevent saving if there are critical errors from incremental validation
      if (incrementalValidation.errorCount > 0 && !options.dryRun) {
        console.error();
        console.error(OutputFormatter.error("Cannot save config: critical validation errors exist"));
        console.error(OutputFormatter.info("Please fix the errors above and try again"));
        process.exit(1);
      }

      // Save or preview
      const defaultPath = options.output || "output/seed-config.json";
      await saveOrPreviewConfig(seedConfig, defaultPath, options.dryRun);

      // Display summary (only if generation completed successfully)
      if (seedConfig && seedConfig.orders.length > 0) {
        performanceMetrics.totalTime = Date.now() - startTime;
        const summaryItems: Array<{ label: string; value: string | number }> = [
          { label: "Orders", value: seedConfig.orders.length },
        ];

        if (seedConfig.collectionPreps && seedConfig.collectionPreps.length > 0) {
          summaryItems.push({ label: "Collection Preps", value: seedConfig.collectionPreps.length });
        } else if (seedConfig.collectionPrep) {
          summaryItems.push({
            label: "Collection Prep",
            value: `${seedConfig.collectionPrep.carrier} at ${seedConfig.collectionPrep.locationId}`,
          });
        }

        console.log();
        console.log(
          OutputFormatter.summary({
            title: OutputFormatter.success("Config Generation Complete!"),
            items: summaryItems,
          }),
        );

        displayPerformanceSummary(performanceMetrics);
      }
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    if (error instanceof Error) {
      const formattedError = ErrorFormatter.formatAsString(error, { step: "Config generation" });
      console.error(`\n${formattedError}\n`);
      if (error.stack && process.env.NODE_ENV === "development") {
        console.error(`Stack trace:\n${error.stack}\n`);
      }
    } else {
      const formattedError = ErrorFormatter.formatAsString(new Error(String(error)), { step: "Config generation" });
      console.error(`\n${formattedError}\n`);
    }
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  const formattedError = ErrorFormatter.formatAsString(error instanceof Error ? error : new Error(String(error)), {
    step: "Config generation",
  });
  console.error(`\n${formattedError}\n`);
  process.exit(1);
});
