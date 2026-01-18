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

/**
 * Display summary of seeding results
 */
export function displaySummary(
  shopifyResult: ShopifyResult,
  wmsResult: WmsResult,
  collectionPrepResult?: { collectionPrepId: string; region: string },
  isDryRun = false,
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
  console.log(OutputFormatter.summary({
    title: isDryRun 
      ? OutputFormatter.header("DRY RUN MODE - No changes will be made", "🔍")
      : OutputFormatter.success("Seeding Complete!"),
    items,
  }));
  
  // Show detailed order list if small number
  if (shopifyResult.shopifyOrders.length <= 10) {
    console.log(OutputFormatter.header("Shopify Orders", "📦"));
    shopifyResult.shopifyOrders.forEach((order) => {
      console.log(OutputFormatter.listItem(`Order #${order.shopifyOrderNumber} (ID: ${order.shopifyOrderId})`));
    });
    console.log();
  }
  
  if (isDryRun) {
    console.log(OutputFormatter.warning("DRY RUN - No actual changes were made"));
    console.log();
  }
}
