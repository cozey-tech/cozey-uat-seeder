/**
 * CLI argument parsing
 */

import { Command } from "commander";
import { seedVersion } from "../index";

export interface CliOptions {
  configFile?: string;
  skipConfirmation: boolean;
  validate: boolean;
  dryRun: boolean;
  resume?: string;
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
    .argument("[config-file]", "Path to seed configuration JSON file (required unless --resume)")
    .option("--validate", "Validate config file schema only (no DB/API calls)")
    .option("--dry-run", "Simulate seeding without making changes")
    .option("--skip-confirmation", "Skip staging confirmation prompt")
    .option("--resume <batch-id>", "Resume a failed seeding operation from batch ID (requires config-file)")
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

  // --resume requires config-file (needed to reconstruct order data)
  if (options.resume && !configFile) {
    console.error("Error: --resume requires a config-file to reconstruct order data\n");
    program.help();
    process.exit(1);
  }

  // Either config-file or --resume is required
  if (!configFile && !options.resume) {
    console.error("Error: either config-file or --resume is required\n");
    program.help();
    process.exit(1);
  }

  return {
    configFile: configFile || undefined,
    skipConfirmation: options.skipConfirmation || false,
    validate: options.validate || false,
    dryRun: options.dryRun || false,
    resume: options.resume || undefined,
  };
}
