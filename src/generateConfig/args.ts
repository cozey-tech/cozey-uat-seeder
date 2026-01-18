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
    .option("--dry-run", "Preview generated config without saving")
    .option("--modify-inventory", "Enable inventory modification during order creation")
    .option("--skip-save-template", "Skip prompt to save custom orders as templates")
    .option("--output <path>", "Output file path (default: output/seed-config.json)")
    .option("--region <region>", "Region (CA or US)", /^(CA|US)$/i)
    .addHelpText(
      "after",
      `
Examples:
  $ npm run generate-config
  $ npm run generate-config -- --region CA
  $ npm run generate-config -- --output custom-config.json
  $ npm run generate-config -- --dry-run
  $ npm run generate-config -- --modify-inventory

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
