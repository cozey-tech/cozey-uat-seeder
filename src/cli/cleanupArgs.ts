export interface CleanupArgs {
  batchId?: string;
  tag?: string;
  dryRun: boolean;
  skipConfirmation: boolean;
}

export function parseCleanupArgs(): CleanupArgs {
  const args = process.argv.slice(2);

  let batchId: string | undefined;
  let tag: string | undefined;
  let dryRun = false;
  let skipConfirmation = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--batch-id" && args[i + 1]) {
      batchId = args[i + 1];
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

  if (!batchId && !tag) {
    throw new Error("Must specify one of: --batch-id, --tag");
  }

  return { batchId, tag, dryRun, skipConfirmation };
}

function displayCleanupHelp(): void {
  console.log(`
Usage: npm run cleanup -- [options]

Options:
  --batch-id <id>           Cleanup orders by batch ID
  --tag <tag>               Cleanup orders by tag (e.g., testTag from config, or wms_seed)
  --dry-run                 Preview what would be deleted without making changes
  --skip-confirmation       Skip confirmation prompt (use with caution)
  --help, -h                Display this help message

Examples:
  npm run cleanup -- --batch-id abc-123-def --dry-run
  npm run cleanup -- --tag Outbound_Compliance
  npm run cleanup -- --tag wms_seed --skip-confirmation
  `);
}
