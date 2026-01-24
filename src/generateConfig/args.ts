/**
 * CLI argument parsing for config generator
 */

import { Command } from "commander";
import { existsSync, accessSync, constants } from "fs";
import { dirname } from "path";
import { seedVersion } from "../index";

export interface CliOptions {
  dryRun: boolean;
  output?: string;
  region?: "CA" | "US";
  modifyInventory: boolean;
  skipSaveTemplate: boolean;
}

/**
 * Parse command line arguments using commander
 */
export function parseArgs(): CliOptions {
  const program = new Command();

  program
    .name("generate-config")
    .description("Interactive config generator for seed configuration files")
    .version(seedVersion, "-v, --version", "display version number")
    .option("--dry-run", "Preview generated config without saving to disk")
    .option("--modify-inventory", "Enable inventory modification during order creation (use with caution)")
    .option("--skip-save-template", "Skip prompt to save custom orders as templates for future use")
    .option("--output <path>", "Output file path for the generated config (default: output/seed-config.json)")
    .option("--region <region>", "Default region for orders: CA (Canada) or US (United States)", /^(CA|US)$/i)
    .addHelpText(
      "after",
      `
Examples:
  Basic usage (interactive prompts):
    $ npm run generate-config

  Specify region and output path:
    $ npm run generate-config -- --region CA --output configs/my-config.json

  Preview config without saving:
    $ npm run generate-config -- --dry-run

  Enable inventory modification (affects warehouse stock):
    $ npm run generate-config -- --modify-inventory

Common Workflows:
  1. First-time users: Run without flags for guided setup
  2. Batch testing: Use --output with descriptive names (e.g., pnp-test.json)
  3. Testing templates: Skip save prompt with --skip-save-template
  4. Preview before commit: Use --dry-run to review config structure

Tips:
  • Save order templates for reusable test scenarios
  • Use descriptive output filenames (e.g., multi-region-pnp.json)
  • Start with --dry-run to validate config structure
  • Review generated config files before running seeder

For more information, see README.md
      `,
    );

  program.parse();

  const options = program.opts();

  // Validate --output path if provided
  if (options.output) {
    const parentDir = dirname(options.output);
    if (!existsSync(parentDir)) {
      throw new Error(`Output directory does not exist: ${parentDir}. Please create it first or use a different path.`);
    }

    // Check if parent directory is writable
    try {
      accessSync(parentDir, constants.W_OK);
    } catch {
      throw new Error(`Output directory is not writable: ${parentDir}. Please check permissions.`);
    }
  }

  // Normalize region to uppercase
  const region = options.region ? (options.region.toUpperCase() as "CA" | "US") : undefined;

  return {
    dryRun: options.dryRun || false,
    modifyInventory: options.modifyInventory || false,
    skipSaveTemplate: options.skipSaveTemplate || false,
    output: options.output,
    region,
  };
}
