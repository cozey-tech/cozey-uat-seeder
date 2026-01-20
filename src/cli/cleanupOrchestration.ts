import type { CleanupArgs } from "./cleanupArgs";
import type { CleanupHandler } from "../business/cleanup/CleanupHandler";
import type { ShopifyService } from "../services/ShopifyService";
import { assertStagingEnvironment } from "../config/stagingGuardrails";
import { InteractivePromptService } from "../services/InteractivePromptService";
import { ProgressTracker } from "../utils/progress";
import { OutputFormatter } from "../utils/outputFormatter";
import { Logger } from "../utils/logger";

export interface CleanupServiceDependencies {
  cleanupHandler: CleanupHandler;
  shopifyService: ShopifyService;
  interactivePromptService: InteractivePromptService;
}

function isValidCleanupTag(tag: string): boolean {
  // Allow wms_seed, seed_batch_id:*, and any custom test tags
  return tag === "wms_seed" || tag.startsWith("seed_batch_id:");
}

export async function executeCleanup(args: CleanupArgs, services: CleanupServiceDependencies): Promise<void> {
  console.log(OutputFormatter.header("Staging Environment Check", "🔒"));
  assertStagingEnvironment();
  console.log(OutputFormatter.success("Staging environment verified"));
  console.log(OutputFormatter.separator());

  const tag = determineTag(args, services.shopifyService);
  // Log info for custom tags (not wms_seed or seed_batch_id:*)
  if (!isValidCleanupTag(tag)) {
    console.log(OutputFormatter.info(`Cleaning up by custom tag: ${tag}`));
  }

  console.log(OutputFormatter.header("Querying Entities", "🔍"));
  console.log(`Tag: ${tag}`);

  const preview = await queryEntitiesForPreview(args, services);

  displayCleanupPreview(preview, args.dryRun);

  if (args.dryRun) {
    console.log("\n" + OutputFormatter.warning("DRY RUN - No actual changes were made"));
    return;
  }

  if (!args.skipConfirmation) {
    const confirmed = await services.interactivePromptService.promptConfirm(
      `\nDelete ${preview.shopifyOrderCount} Shopify orders and ${preview.wmsEntityCount} WMS entities?`,
      false,
    );
    if (!confirmed) {
      console.log("\n" + OutputFormatter.info("Cleanup cancelled by user"));
      return;
    }
  }

  console.log("\n" + OutputFormatter.header("Deleting Entities", "🗑️"));

  const progressTracker = new ProgressTracker();
  progressTracker.start("Deleting entities", preview.totalEntities);

  try {
    const result = await services.cleanupHandler.execute({
      ...args,
      onProgress: (current: number, total: number, entityType: string) => {
        progressTracker.update(current, entityType);
      },
    });

    progressTracker.complete();

    displayCleanupResults(result);
  } catch (error) {
    progressTracker.complete();
    throw error;
  }
}

function determineTag(args: CleanupArgs, shopifyService: ShopifyService): string {
  if (args.batchId) {
    return shopifyService.formatBatchTag(args.batchId);
  } else if (args.tag) {
    return args.tag;
  }
  throw new Error("No tag specified");
}

async function queryEntitiesForPreview(
  args: CleanupArgs,
  services: CleanupServiceDependencies,
): Promise<{
  shopifyOrderCount: number;
  wmsEntityCount: number;
  totalEntities: number;
}> {
  const tag = determineTag(args, services.shopifyService);
  const shopifyOrders = await services.shopifyService.queryOrdersByTag(tag);

  console.log(`Found ${shopifyOrders.length} Shopify orders`);

  if (shopifyOrders.length === 0) {
    return {
      shopifyOrderCount: 0,
      wmsEntityCount: 0,
      totalEntities: 0,
    };
  }

  Logger.info("Preview query complete", {
    shopifyOrderCount: shopifyOrders.length,
    tag,
  });

  return {
    shopifyOrderCount: shopifyOrders.length,
    wmsEntityCount: shopifyOrders.length * 5,
    totalEntities: shopifyOrders.length * 6,
  };
}

function displayCleanupPreview(
  preview: {
    shopifyOrderCount: number;
    wmsEntityCount: number;
  },
  dryRun: boolean,
): void {
  console.log("\n" + OutputFormatter.header(dryRun ? "Preview (Dry Run)" : "Entities to Delete", dryRun ? "👁️" : "🗑️"));
  console.log(`  Shopify Orders: ${preview.shopifyOrderCount}`);
  console.log(`  WMS Entities:   ~${preview.wmsEntityCount} (orders, preps, shipments, etc.)`);
  console.log(OutputFormatter.separator());
}

function displayCleanupResults(result: {
  shopifyOrders: { deleted: string[]; archived: string[]; failed: Array<{ orderId: string; error: string }> };
  wmsEntities: {
    orders: { deleted: number; failed: number };
    preps: { deleted: number; failed: number };
    shipments: { deleted: number; failed: number };
    collectionPreps: { deleted: number; failed: number };
  };
  summary: { totalDeleted: number; totalArchived: number; totalFailed: number; durationMs: number };
}): void {
  console.log("\n" + OutputFormatter.header("Cleanup Summary", "📊"));

  console.log("\n  Shopify Orders:");
  console.log(`    Deleted:  ${result.shopifyOrders.deleted.length}`);
  if (result.shopifyOrders.archived.length > 0) {
    console.log(`    Archived: ${result.shopifyOrders.archived.length} (payment restriction - not fully deleted)`);
  }
  console.log(`    Failed:   ${result.shopifyOrders.failed.length}`);

  console.log("\n  WMS Entities:");
  console.log(`    Orders:           ${result.wmsEntities.orders.deleted} deleted`);
  console.log(`    Preps:            ${result.wmsEntities.preps.deleted} deleted`);
  console.log(`    Shipments:        ${result.wmsEntities.shipments.deleted} deleted`);
  console.log(`    Collection Preps: ${result.wmsEntities.collectionPreps.deleted} deleted`);

  console.log("\n  Overall:");
  console.log(`    Total Deleted:  ${result.summary.totalDeleted}`);
  if (result.summary.totalArchived > 0) {
    console.log(`    Total Archived: ${result.summary.totalArchived}`);
  }
  console.log(`    Total Failed:   ${result.summary.totalFailed}`);
  console.log(`    Duration:       ${(result.summary.durationMs / 1000).toFixed(2)}s`);

  console.log(OutputFormatter.separator());

  if (result.summary.totalFailed > 0) {
    console.log("\n" + OutputFormatter.warning("Some entities failed to delete. Check logs for details."));

    if (result.shopifyOrders.failed.length > 0) {
      console.log("\nFailed Shopify Orders:");
      for (const failed of result.shopifyOrders.failed.slice(0, 5)) {
        console.log(`  - ${failed.orderId}: ${failed.error}`);
      }
      if (result.shopifyOrders.failed.length > 5) {
        console.log(`  ... and ${result.shopifyOrders.failed.length - 5} more`);
      }
    }
  } else {
    console.log("\n" + OutputFormatter.success("Cleanup completed successfully!"));
  }
}
