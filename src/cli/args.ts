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
  noColor: boolean;
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
    .option("--validate", "Validate config file schema only without connecting to database or APIs")
    .option("--dry-run", "Simulate seeding without making changes (preview what would be created)")
    .option("--skip-confirmation", "Skip staging environment confirmation prompt (use with caution)")
    .option(
      "--resume <batch-id>",
      "Resume a failed seeding operation from batch ID (uses stored config if none provided)",
    )
    .option(
      "--use-direct-mode",
      "Use direct Prisma mode bypassing COS webhook (for debugging). Default is webhook mode.",
    )
    .option("--polling-timeout <seconds>", "COS webhook polling timeout in seconds (default: 180 = 3 minutes)", "180")
    .option("--polling-interval <seconds>", "COS webhook polling interval in seconds (default: 2)", "2")
    .option("--no-color", "Disable colored output (useful for CI/CD or non-TTY environments)")
    .addHelpText(
      "after",
      `
Examples:
  Basic seeding:
    $ npm run seed config.json

  Validate config before seeding:
    $ npm run seed config.json --validate

  Preview changes without creating data:
    $ npm run seed config.json --dry-run

  Resume a failed seeding operation:
    $ npm run seed --resume batch-123                    # Uses stored config
    $ npm run seed modified.json --resume batch-123       # Uses new config (with warning)

  Skip confirmation prompt (CI/CD):
    $ npm run seed config.json --skip-confirmation

  Debug mode (direct WMS creation):
    $ npm run seed config.json --use-direct-mode

Webhook Mode (default):
  Creates Shopify orders and waits for COS to ingest via webhook (1-2 minutes).
  Ensures test data matches production (inventory updates, history).
  Recommended for realistic testing scenarios.

Direct Mode (fallback):
  Directly creates WMS entities via Prisma. Use for debugging or if COS is unavailable.
  Faster but skips production webhook flow.

Common Workflows:
  1. First run: Validate config → Run with --dry-run → Execute seeding
  2. Failed run: Note batch ID from error → Fix config → Resume with --resume
  3. CI/CD: Use --skip-confirmation with pre-validated configs
  4. Debugging: Use --use-direct-mode to bypass webhook wait times

Tips:
  • Always validate configs before seeding: npm run seed config.json --validate
  • Use --dry-run to preview order structure and catch issues early
  • Failed runs can be resumed without re-creating successful orders
  • Batch IDs are displayed in output and stored in .progress/ directory
  • Webhook mode is recommended for realistic production-like testing

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
    noColor: options.color === false, // Commander's --no-color sets color to false
  };
}
