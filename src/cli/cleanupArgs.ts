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

Options:
  --batch-id <id>          Delete entities with seed_batch_id tag
  --collection-prep <name> Delete entities with collection_prep tag
  --tag <tag>              Delete entities with custom tag
  --dry-run                Preview deletions without making changes
  --skip-confirmation      Skip confirmation prompt (use with caution)
  --help, -h               Display this help message

Examples:
  npm run cleanup -- --batch-id abc-123-def-456
  npm run cleanup -- --collection-prep Test-Canpar-Langley-1234 --dry-run
  npm run cleanup -- --tag wms_seed
  `);
}
