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
  useDirectMode: boolean;
  pollingTimeout: number; // seconds
  pollingInterval: number; // seconds
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
    .option("--use-direct-mode", "Use direct Prisma mode (bypass COS webhook, for debugging). Default is webhook mode.")
    .option("--polling-timeout <seconds>", "COS webhook polling timeout in seconds (default: 180 = 3 minutes)", "180")
    .option("--polling-interval <seconds>", "COS webhook polling interval in seconds (default: 5)", "5")
    .addHelpText(
      "after",
      `
Examples:
  $ npm run seed config.json
  $ npm run seed config.json --validate
  $ npm run seed config.json --dry-run
  $ npm run seed config.json --skip-confirmation
  $ npm run seed config.json --use-direct-mode

Webhook Mode (default):
  Creates Shopify orders and waits for COS to ingest via webhook (1-2 minutes).
  Ensures test data matches production (inventory updates, history).

Direct Mode (fallback):
  Directly creates WMS entities via Prisma. Use for debugging or if COS is unavailable.

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
    useDirectMode: options.useDirectMode || false,
    pollingTimeout: parseInt(options.pollingTimeout),
    pollingInterval: parseInt(options.pollingInterval),
  };
}
