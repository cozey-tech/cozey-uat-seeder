export interface CleanupArgs {
  batchId?: string;
  collectionPrepName?: string;
  tag?: string;
  dryRun: boolean;
  skipConfirmation: boolean;
}

export function parseCleanupArgs(): CleanupArgs {
  const args = process.argv.slice(2);

  let batchId: string | undefined;
  let collectionPrepName: string | undefined;
  let tag: string | undefined;
  let dryRun = false;
  let skipConfirmation = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--batch-id" && args[i + 1]) {
      batchId = args[i + 1];
      i++;
    } else if (arg === "--collection-prep" && args[i + 1]) {
      collectionPrepName = args[i + 1];
      i++;
    } else if (arg === "--tag" && args[i + 1]) {
      tag = args[i + 1];
      i++;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--skip-confirmation") {
      skipConfirmation = true;
    } else if (arg === "--help" || arg === "-h") {
      displayCleanupHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!batchId && !collectionPrepName && !tag) {
    throw new Error("Must specify one of: --batch-id, --collection-prep, --tag");
  }

  return { batchId, collectionPrepName, tag, dryRun, skipConfirmation };
}

function displayCleanupHelp(): void {
  console.log(`
Usage: npm run cleanup -- [options]

Description:
  Delete test data created by the seeder. Supports cleanup by batch ID, collection prep name, or tag.
  Always runs in staging environment only (safety check enforced).

Options:
  --batch-id <id>           Cleanup all orders and entities from a specific seeding batch
  --collection-prep <name>  Cleanup all orders associated with a collection prep name
  --tag <tag>               Cleanup orders by tag (e.g., testTag from config, or wms_seed)
  --dry-run                 Preview what would be deleted without making any changes
  --skip-confirmation       Skip confirmation prompt (use with caution in automated workflows)
  --help, -h                Display this help message

Examples:
  Preview cleanup by batch ID:
    $ npm run cleanup -- --batch-id abc-123-def --dry-run

  Delete all data from a specific batch:
    $ npm run cleanup -- --batch-id abc-123-def

  Cleanup by collection prep name:
    $ npm run cleanup -- --collection-prep uat_outbound_compliance-Canpar-LangleyFc-B4CE

  Cleanup by custom tag:
    $ npm run cleanup -- --tag Outbound_Compliance

  Cleanup all seeded data (automated):
    $ npm run cleanup -- --tag wms_seed --skip-confirmation

Common Workflows:
  1. Preview before delete: Run with --dry-run first to verify what will be deleted
  2. Failed seeding cleanup: Use batch ID from failed run to cleanup partial data
  3. Test suite cleanup: Use --tag with --skip-confirmation for automated teardown
  4. Collection prep cleanup: Safely removes prep and associated orders/shipments

Safety Features:
  • Staging-only enforcement (will not run in production)
  • Confirmation prompt by default (requires explicit yes/no)
  • Collection prep safety check (won't delete if referenced by other batches)
  • Dry-run mode to preview changes before execution
  • Transaction-based deletion (atomic operations)

Tips:
  • Always use --dry-run first to preview deletions
  • Batch IDs are shown in seeder output and stored in .progress/ directory
  • Collection prep names follow pattern: uat_[purpose]-[carrier]-[warehouse]-[hash]
  • Use --tag wms_seed to cleanup ALL seeded test data
  • Failed cleanups can be retried (operations are idempotent)

For more information, see docs/ folder
  `);
}
