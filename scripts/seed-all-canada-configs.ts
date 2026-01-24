#!/usr/bin/env tsx

/**
 * Script to seed all 20 Canada order config files sequentially
 *
 * Usage:
 *   npm run seed-all-canada-configs
 *   npm run seed-all-canada-configs -- --skip-confirmation
 *   npm run seed-all-canada-configs -- --use-direct-mode
 */

import { execSync } from "child_process";
import { join } from "path";
import { existsSync } from "fs";

const CONFIG_DIR = join(process.cwd(), "config");
const TOTAL_CONFIGS = 20;

interface Options {
  skipConfirmation?: boolean;
  useDirectMode?: boolean;
  continueOnError?: boolean;
  startFrom?: number;
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
      if (isNaN(options.startFrom) || options.startFrom < 1 || options.startFrom > TOTAL_CONFIGS) {
        console.error(`❌ Invalid --start-from value. Must be between 1 and ${TOTAL_CONFIGS}`);
        process.exit(1);
      }
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: npm run seed-all-canada-configs [options]

Options:
  --skip-confirmation      Skip staging confirmation prompt for each config
  --use-direct-mode        Use direct Prisma mode (bypass COS webhook)
  --continue-on-error      Continue to next config even if current one fails
  --start-from <number>    Start from a specific config number (1-20)
  --help, -h               Show this help message

Examples:
  npm run seed-all-canada-configs
  npm run seed-all-canada-configs -- --skip-confirmation
  npm run seed-all-canada-configs -- --use-direct-mode --continue-on-error
  npm run seed-all-canada-configs -- --start-from 5
`);
      process.exit(0);
    }
  }

  return options;
}

function getConfigPath(batchNumber: number): string {
  const paddedNumber = batchNumber.toString().padStart(2, "0");
  return join(CONFIG_DIR, `canada-orders-batch-${paddedNumber}.json`);
}

function seedConfig(batchNumber: number, options: Options): boolean {
  const configPath = getConfigPath(batchNumber);
  const paddedNumber = batchNumber.toString().padStart(2, "0");

  if (!existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`);
    return false;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📦 Seeding batch ${paddedNumber}/20: canada-orders-batch-${paddedNumber}.json`);
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

    console.log(`\n✅ Successfully seeded batch ${paddedNumber}/20\n`);
    return true;
  } catch (error) {
    console.error(`\n❌ Failed to seed batch ${paddedNumber}/20\n`);
    if (!options.continueOnError) {
      console.error("Stopping execution. Use --continue-on-error to continue despite failures.\n");
      throw error;
    }
    return false;
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  const startFrom = options.startFrom || 1;

  console.log("\n🚀 Starting batch seeding for all Canada order configs");
  console.log(`   Starting from batch ${startFrom}/20\n`);

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

  for (let i = startFrom; i <= TOTAL_CONFIGS; i++) {
    const success = seedConfig(i, options);
    if (success) {
      results.successful++;
    } else {
      results.failed++;
      if (!options.continueOnError) {
        break;
      }
    }
  }

  if (startFrom > 1) {
    results.skipped = startFrom - 1;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`✅ Successful: ${results.successful}`);
  console.log(`❌ Failed: ${results.failed}`);
  if (results.skipped > 0) {
    console.log(`⏭️  Skipped: ${results.skipped}`);
  }
  console.log(`📦 Total: ${results.successful + results.failed + results.skipped}/20`);
  console.log(`${"=".repeat(60)}\n`);

  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
