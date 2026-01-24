/**
 * Output formatting functions for CLI
 */

import { OutputFormatter } from "../utils/outputFormatter";

export interface ShopifyResult {
  shopifyOrders: Array<{ shopifyOrderId: string; shopifyOrderNumber: string }>;
  failures?: Array<{ orderIndex: number; customerEmail: string; error: string }>;
}

export interface WmsResult {
  orders: Array<{ orderId: string }>;
  shipments: Array<{ shipmentId: string }>;
  failures?: Array<{ orderIndex: number; shopifyOrderId: string; customerEmail?: string; error: string }>;
}

export interface TimingMetrics {
  shopifyDuration?: number; // milliseconds
  wmsDuration?: number; // milliseconds
  webhookDuration?: number; // milliseconds
  collectionPrepDuration?: number; // milliseconds
  totalDuration?: number; // milliseconds
}

/**
 * Display summary of seeding results
 */
export function displaySummary(
  shopifyResult: ShopifyResult,
  wmsResult: WmsResult,
  collectionPrepResult?: { collectionPrepId: string; region: string },
  isDryRun = false,
  timingMetrics?: TimingMetrics,
): void {
  const items: Array<{ label: string; value: string | number }> = [];

  const shopifySuccess = shopifyResult.shopifyOrders.length;
  const shopifyFailures = shopifyResult.failures?.length || 0;
  const shopifyTotal = shopifySuccess + shopifyFailures;

  items.push({
    label: `Shopify Orders ${isDryRun ? "Would Be" : "Created"}`,
    value: shopifyFailures > 0 ? `${shopifySuccess}/${shopifyTotal}` : shopifySuccess,
  });

  const wmsSuccess = wmsResult.orders.length;
  const wmsFailures = wmsResult.failures?.length || 0;
  const wmsTotal = wmsSuccess + wmsFailures;

  items.push({
    label: "WMS Orders",
    value: wmsFailures > 0 ? `${wmsSuccess}/${wmsTotal}` : wmsSuccess,
  });

  items.push({
    label: "WMS Shipments",
    value: wmsResult.shipments.length,
  });

  if (collectionPrepResult) {
    items.push({
      label: "Collection Prep ID",
      value: collectionPrepResult.collectionPrepId,
    });
    items.push({
      label: "Collection Prep Region",
      value: collectionPrepResult.region,
    });
  }

  if (shopifyFailures > 0 || wmsFailures > 0) {
    items.push({
      label: "Total Failures",
      value: (shopifyFailures || 0) + (wmsFailures || 0),
    });
  }

  console.log();
  console.log(
    OutputFormatter.summary({
      title: isDryRun
        ? OutputFormatter.header("DRY RUN MODE - No changes will be made", "🔍")
        : OutputFormatter.success("Seeding Complete!"),
      items,
    }),
  );

  // Show detailed order list if small number
  if (shopifyResult.shopifyOrders.length <= 10) {
    console.log(OutputFormatter.header("Shopify Orders", "📦"));
    for (const order of shopifyResult.shopifyOrders) {
      console.log(OutputFormatter.listItem(`Order #${order.shopifyOrderNumber} (ID: ${order.shopifyOrderId})`));
    }
    console.log();
  }

  if (isDryRun) {
    console.log(OutputFormatter.warning("DRY RUN - No actual changes were made"));
    console.log();
  }

  // Display timing breakdown if provided
  if (timingMetrics && Object.keys(timingMetrics).length > 0) {
    console.log(OutputFormatter.header("Timing Breakdown", "⏱️"));

    if (timingMetrics.shopifyDuration !== undefined) {
      console.log(OutputFormatter.listItem(`Shopify Orders: ${formatDuration(timingMetrics.shopifyDuration)}`));
    }

    if (timingMetrics.webhookDuration !== undefined) {
      console.log(OutputFormatter.listItem(`COS Webhook Ingestion: ${formatDuration(timingMetrics.webhookDuration)}`));
    }

    if (timingMetrics.wmsDuration !== undefined) {
      console.log(OutputFormatter.listItem(`WMS Entities: ${formatDuration(timingMetrics.wmsDuration)}`));
    }

    if (timingMetrics.collectionPrepDuration !== undefined) {
      console.log(OutputFormatter.listItem(`Collection Prep: ${formatDuration(timingMetrics.collectionPrepDuration)}`));
    }

    if (timingMetrics.totalDuration !== undefined) {
      console.log();
      console.log(OutputFormatter.success(`Total Duration: ${formatDuration(timingMetrics.totalDuration)}`));
    }

    console.log();
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
