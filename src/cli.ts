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

import { v4 as uuidv4 } from "uuid";
import { initializeEnvConfig } from "./config/env";
import { ProgressTracker } from "./utils/progress";
import { ErrorFormatter } from "./utils/errorFormatter";
import { OutputFormatter } from "./utils/outputFormatter";
import { parseArgs } from "./cli/args";
import { validateConfig, checkStagingEnvironment, parseAndValidateConfig, validateData } from "./cli/validation";
import { initializeServices, executeSeedingFlow, executeDryRun } from "./cli/orchestration";
import { displaySummary } from "./cli/output";

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
        await executeDryRun(options.configFile, services);
      } finally {
        // Cleanup
        await services.prisma.$disconnect();
      }
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
