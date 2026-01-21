#!/usr/bin/env node

/**
 * CLI Entry Point for Cozey UAT Seeder
 *
 * Orchestrates the seeding workflow: validates staging environment,
 * parses configuration, seeds Shopify orders and WMS entities,
 * and optionally creates collection preps.
 */

import { config } from "dotenv";
import { resolve } from "path";

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
import { loadProgressState, listProgressStates } from "./utils/progressState";

/**
 * Main orchestrator function
 */
async function main(): Promise<void> {
  try {
    await initializeEnvConfig();

    const options = parseArgs();

    if (options.resume) {
      const resumeState = loadProgressState(options.resume);
      if (!resumeState) {
        console.error(OutputFormatter.error(`No progress state found for batch ID: ${options.resume}`));
        console.log(OutputFormatter.info("Available batch IDs:"));
        const availableStates = listProgressStates();
        if (availableStates.length === 0) {
          console.log(OutputFormatter.info("   (none)"));
        } else {
          for (const state of availableStates.slice(0, 10)) {
            const date = new Date(state.timestamp).toISOString();
            console.log(OutputFormatter.keyValue(state.batchId, date));
          }
        }
        process.exit(1);
      }

      checkStagingEnvironment();

      // Initialize services
      console.log(OutputFormatter.info("Initializing services for resume..."));
      const initProgress = new ProgressTracker({ showSpinner: false });
      initProgress.start("Initializing", 4);

      initProgress.update(1, "Connecting to database...");
      const services = initializeServices(false);
      initProgress.update(2, "Initializing Shopify client...");
      initProgress.update(3, "Loading reference data...");
      initProgress.update(4, "Ready");
      initProgress.complete("Services initialized");
      console.log();

      // Load original config from progress state (we'd need to store it, but for now we'll require it)
      // For now, we'll require the config file even when resuming
      if (!options.configFile) {
        console.error(
          OutputFormatter.error("Config file is required when resuming (needed to reconstruct order data)"),
        );
        process.exit(1);
      }

      try {
        const config = parseAndValidateConfig(options.configFile, services.inputParser);
        await validateData(config, services.dataValidator);

        console.log(OutputFormatter.keyValue("Resuming Batch ID", options.resume));
        console.log();

        const executionOptions = {
          useWebhookMode: !options.useDirectMode,
          pollingTimeout: options.pollingTimeout,
          pollingInterval: options.pollingInterval,
        };

        const { shopifyResult, wmsResult, collectionPrepResult } = await executeSeedingFlow(
          config,
          services,
          options.resume,
          false,
          executionOptions,
          resumeState,
        );

        displaySummary(shopifyResult, wmsResult, collectionPrepResult, false);
      } finally {
        await services.prisma.$disconnect();
      }
      process.exit(0);
    }

    // Handle --validate flag (early exit, no DB/API calls)
    if (options.validate) {
      if (!options.configFile) {
        console.error(OutputFormatter.error("Config file is required for validation"));
        process.exit(1);
      }
      await validateConfig(options.configFile);
      process.exit(0);
    }

    // Handle --dry-run flag
    if (options.dryRun) {
      if (!options.configFile) {
        console.error(OutputFormatter.error("Config file is required for dry-run"));
        process.exit(1);
      }
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
      if (!options.configFile) {
        console.error(OutputFormatter.error("Config file is required"));
        process.exit(1);
      }

      const config = parseAndValidateConfig(options.configFile, services.inputParser);
      await validateData(config, services.dataValidator);

      // Generate batch ID for this run
      const batchId = uuidv4();
      console.log(OutputFormatter.keyValue("Batch ID", batchId));

      // Show mode selection
      if (options.useDirectMode) {
        console.log(OutputFormatter.info("Mode: DIRECT (bypassing COS webhook)"));
      } else {
        console.log(OutputFormatter.info("Mode: WEBHOOK (production-like, waiting for COS ingestion)"));
      }
      console.log();

      const executionOptions = {
        useWebhookMode: !options.useDirectMode,
        pollingTimeout: options.pollingTimeout,
        pollingInterval: options.pollingInterval,
      };

      const { shopifyResult, wmsResult, collectionPrepResult } = await executeSeedingFlow(
        config,
        services,
        batchId,
        false,
        executionOptions,
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
