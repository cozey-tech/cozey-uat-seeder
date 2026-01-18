/**
 * CLI argument parsing
 */

import { Command } from "commander";
import { seedVersion } from "../index";

export interface CliOptions {
  configFile: string;
  skipConfirmation: boolean;
  validate: boolean;
  dryRun: boolean;
}

/**
 * Parse command line arguments using commander
 */
export function parseArgs(): CliOptions {
  const program = new Command();

  program
    .name("seed")
    .description("Seeder for Shopify staging orders and WMS staging entities")
    .version(seedVersion, "-v, --version", "display version number")
    .argument("<config-file>", "Path to seed configuration JSON file")
    .option("--validate", "Validate config file schema only (no DB/API calls)")
    .option("--dry-run", "Simulate seeding without making changes")
    .option("--skip-confirmation", "Skip staging confirmation prompt")
    .addHelpText(
      "after",
      `
Examples:
  $ npm run seed config.json
  $ npm run seed config.json --validate
  $ npm run seed config.json --dry-run
  $ npm run seed config.json --skip-confirmation

For more information, see README.md
      `,
    );

  program.parse();

  const options = program.opts();
  const configFile = program.args[0];

  // Validate flags are mutually exclusive
  if (options.validate && options.dryRun) {
    console.error("Error: --validate and --dry-run cannot be used together\n");
    program.help();
    process.exit(1);
  }

  if (!configFile) {
    console.error("Error: config file path is required\n");
    program.help();
    process.exit(1);
  }

  return {
    configFile,
    skipConfirmation: options.skipConfirmation || false,
    validate: options.validate || false,
    dryRun: options.dryRun || false,
  };
}
