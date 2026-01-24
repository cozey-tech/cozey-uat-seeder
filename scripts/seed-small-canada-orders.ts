#!/usr/bin/env tsx

/**
 * Script to seed all small Canada order config files sequentially
 *
 * Usage:
 *   npm run seed-small-canada-orders
 *   npm run seed-small-canada-orders -- --skip-confirmation
 *   npm run seed-small-canada-orders -- --use-direct-mode
 *   npm run seed-small-canada-orders -- --start-from 5
 */

import { execSync } from "child_process";
import { join } from "path";
import { existsSync, readdirSync } from "fs";

const CONFIG_DIR = join(process.cwd(), "config");
const CONFIG_PREFIX = "canada-small-orders-batch-";

interface Options {
  skipConfirmation?: boolean;
  useDirectMode?: boolean;
  continueOnError?: boolean;
  startFrom?: number;
  maxBatches?: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--skip-confirmation") {
      options.skipConfirmation = true;
    } else if (arg === "--use-direct-mode") {
      options.useDirectMode = true;
    } else if (arg === "--continue-on-error") {
      options.continueOnError = true;
    } else if (arg === "--start-from" && i + 1 < args.length) {
      options.startFrom = parseInt(args[i + 1], 10);
      if (isNaN(options.startFrom) || options.startFrom < 1) {
        console.error(`❌ Invalid --start-from value. Must be >= 1`);
        process.exit(1);
      }
      i++;
    } else if (arg === "--max-batches" && i + 1 < args.length) {
      options.maxBatches = parseInt(args[i + 1], 10);
      if (isNaN(options.maxBatches) || options.maxBatches < 1) {
        console.error(`❌ Invalid --max-batches value. Must be >= 1`);
        process.exit(1);
      }
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: npm run seed-small-canada-orders [options]

Options:
  --skip-confirmation      Skip staging confirmation prompt for each config
  --use-direct-mode        Use direct Prisma mode (bypass COS webhook)
  --continue-on-error      Continue to next config even if current one fails
  --start-from <number>    Start from a specific config number (default: 1)
  --max-batches <number>   Maximum number of batches to process (default: all)
  --help, -h               Show this help message

Examples:
  npm run seed-small-canada-orders
  npm run seed-small-canada-orders -- --skip-confirmation
  npm run seed-small-canada-orders -- --use-direct-mode --continue-on-error
  npm run seed-small-canada-orders -- --start-from 5
  npm run seed-small-canada-orders -- --max-batches 5
`);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Find all small order config files and return them sorted by batch number
 */
function findSmallOrderConfigs(): Array<{ batchNumber: number; path: string }> {
  const files = readdirSync(CONFIG_DIR);
  const configs: Array<{ batchNumber: number; path: string }> = [];

  for (const file of files) {
    if (file.startsWith(CONFIG_PREFIX) && file.endsWith(".json")) {
      // Extract batch number from filename: canada-small-orders-batch-01.json -> 1
      const match = file.match(/canada-small-orders-batch-(\d+)\.json/);
      if (match) {
        const batchNumber = parseInt(match[1], 10);
        if (!isNaN(batchNumber)) {
          configs.push({
            batchNumber,
            path: join(CONFIG_DIR, file),
          });
        }
      }
    }
  }

  // Sort by batch number
  configs.sort((a, b) => a.batchNumber - b.batchNumber);

  return configs;
}

function seedConfig(batchNumber: number, configPath: string, totalConfigs: number, options: Options): boolean {
  const paddedNumber = batchNumber.toString().padStart(2, "0");

  if (!existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`);
    return false;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📦 Seeding batch ${paddedNumber}/${totalConfigs}: canada-small-orders-batch-${paddedNumber}.json`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    const commandParts = ["npm", "run", "seed", configPath];
    if (options.skipConfirmation) {
      commandParts.push("--skip-confirmation");
    }
    if (options.useDirectMode) {
      commandParts.push("--use-direct-mode");
    }

    execSync(commandParts.join(" "), {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    console.log(`\n✅ Successfully seeded batch ${paddedNumber}/${totalConfigs}\n`);
    return true;
  } catch (error) {
    console.error(`\n❌ Failed to seed batch ${paddedNumber}/${totalConfigs}\n`);
    if (!options.continueOnError) {
      console.error("Stopping execution. Use --continue-on-error to continue despite failures.\n");
      throw error;
    }
    return false;
  }
}

async function main(): Promise<void> {
  const options = parseArgs();

  // Find all small order config files
  const allConfigs = findSmallOrderConfigs();

  if (allConfigs.length === 0) {
    console.error("❌ No small order config files found!");
    console.error(`   Looking for files matching: ${CONFIG_PREFIX}*.json in ${CONFIG_DIR}`);
    process.exit(1);
  }

  // Filter configs based on options
  let configsToProcess = allConfigs;

  if (options.startFrom) {
    configsToProcess = configsToProcess.filter((c) => c.batchNumber >= options.startFrom!);
  }

  if (options.maxBatches) {
    configsToProcess = configsToProcess.slice(0, options.maxBatches);
  }

  if (configsToProcess.length === 0) {
    console.error("❌ No configs to process after applying filters");
    process.exit(1);
  }

  const totalConfigs = allConfigs.length;
  const startFrom = configsToProcess[0]?.batchNumber || 1;

  console.log("\n🚀 Starting batch seeding for small Canada order configs");
  console.log(`   Found ${allConfigs.length} config file(s)`);
  console.log(`   Processing ${configsToProcess.length} config(s)`);
  if (options.startFrom) {
    console.log(`   Starting from batch ${startFrom}`);
  }
  console.log();

  if (options.skipConfirmation) {
    console.log("ℹ️  Skipping confirmation prompts\n");
  }
  if (options.useDirectMode) {
    console.log("ℹ️  Using direct mode (bypassing COS webhook)\n");
  }
  if (options.continueOnError) {
    console.log("ℹ️  Will continue on errors\n");
  }

  const results = {
    successful: 0,
    failed: 0,
    skipped: 0,
  };

  for (const config of configsToProcess) {
    const success = seedConfig(config.batchNumber, config.path, totalConfigs, options);
    if (success) {
      results.successful++;
    } else {
      results.failed++;
      if (!options.continueOnError) {
        break;
      }
    }
  }

  if (options.startFrom && options.startFrom > 1) {
    results.skipped = options.startFrom - 1;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`✅ Successful: ${results.successful}`);
  console.log(`❌ Failed: ${results.failed}`);
  if (results.skipped > 0) {
    console.log(`⏭️  Skipped: ${results.skipped}`);
  }
  console.log(`📦 Total Processed: ${results.successful + results.failed}/${configsToProcess.length}`);
  console.log(`📦 Total Available: ${allConfigs.length}`);
  console.log(`${"=".repeat(60)}\n`);

  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
