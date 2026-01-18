/**
 * Collection prep flows for config generator
 */

import type { Carrier } from "../../repositories/ConfigDataRepository";
import { InteractivePromptService } from "../../services/InteractivePromptService";
import { OutputFormatter } from "../../utils/outputFormatter";
import { Logger } from "../../utils/logger";
import type { Order } from "./orderCreation";
import { validateCollectionPrep, displayValidationIssues } from "./validation";

export interface CollectionPrepConfig {
  carrier: Carrier;
  locationId: string;
  prepDate: Date;
  testTag?: string;
  orderIndices?: number[];
}

export interface CollectionPrepContext {
  carriers: Carrier[];
  orders: Order[];
  promptService: InteractivePromptService;
}

/**
 * Configure collection preps based on builder mode
 */
export async function configureCollectionPreps(
  context: CollectionPrepContext,
): Promise<{
  collectionPreps?: CollectionPrepConfig[];
  collectionPrepCount?: number;
  carrier?: Carrier;
  prepDate?: Date;
  testTag?: string;
}> {
  const { carriers, orders, promptService } = context;

  Logger.info("Starting collection prep configuration", {
    orderCount: orders.length,
    carrierCount: carriers.length,
  });
  
  console.log();
  console.log(OutputFormatter.header("Collection Prep Configuration", "📋"));
  console.log(OutputFormatter.separator());

  let collectionPreps: CollectionPrepConfig[] | undefined;
  let collectionPrepCount: number | undefined;
  let carrier: Carrier | undefined;
  let prepDate: Date | undefined;
  let testTag: string | undefined;

  if (carriers.length === 0) {
    Logger.warn("No carriers available for collection prep", {
      orderCount: orders.length,
    });
    return {};
  }

  const builderMode = await promptService.promptCollectionPrepBuilderMode();

  if (builderMode === "bulk") {
    // Bulk collection prep creation mode
    const bulkConfig = await promptService.promptBulkCollectionPrepConfig(
      carriers,
      orders.length,
    );

    // Group orders by locationId
    const ordersByLocation = new Map<string, number[]>();
    for (let i = 0; i < orders.length; i++) {
      const locationId = orders[i].locationId;
      if (!locationId) {
        throw new Error(`Order ${i + 1} has no locationId`);
      }
      if (!ordersByLocation.has(locationId)) {
        ordersByLocation.set(locationId, []);
      }
      ordersByLocation.get(locationId)!.push(i);
    }

    if (ordersByLocation.size === 0) {
      throw new Error("Cannot create collection prep: no locationId found in orders");
    }

    // Create collection preps with auto-allocated orders, grouped by locationId
    collectionPreps = [];
    let prepIndex = 0;

    // Process each locationId group separately
    for (const [locationId, locationOrderIndices] of ordersByLocation.entries()) {
      // Allocate carriers for this location (round-robin across all carriers)
      const carriersForLocation = bulkConfig.carriers;
      const prepsPerLocation = Math.min(bulkConfig.count, locationOrderIndices.length);

      for (let i = 0; i < prepsPerLocation; i++) {
        // Round-robin order allocation within this location
        const orderIndices: number[] = [];
        for (let j = i; j < locationOrderIndices.length; j += prepsPerLocation) {
          orderIndices.push(locationOrderIndices[j]);
        }

        // Round-robin carrier assignment
        const carrierIndex = prepIndex % carriersForLocation.length;
        collectionPreps.push({
          carrier: carriersForLocation[carrierIndex],
          locationId,
          prepDate: new Date(),
          testTag: bulkConfig.baseTestTag,
          orderIndices,
        });
        prepIndex++;
      }
    }

    // Validate collection preps
    for (let i = 0; i < collectionPreps.length; i++) {
      const prep = collectionPreps[i];
      const prepOrders = prep.orderIndices
        ? prep.orderIndices.map((idx) => orders[idx])
        : [];
      const validation = validateCollectionPrep(
        i,
        prep.orderIndices || [],
        prepOrders.map((o) => ({ composition: o.composition })),
        false, // PnP config validation would need to be passed in
      );
      if (validation.issues.length > 0) {
        displayValidationIssues(validation.issues);
      }
    }
    
    // Show allocation summary
    console.log();
    console.log(OutputFormatter.header("Bulk Collection Prep Summary", "📊"));
    console.log(OutputFormatter.separator());
    for (let i = 0; i < collectionPreps.length; i++) {
      const prep = collectionPreps[i];
      const orderList = prep.orderIndices
        ? prep.orderIndices.map((idx) => idx + 1).join(", ")
        : "None";
      console.log(
        `   Prep ${i + 1}: ${prep.carrier.name} @ ${prep.locationId} - Orders: ${orderList} (${prep.orderIndices?.length || 0} orders)`,
      );
    }
    console.log(OutputFormatter.separator());
    console.log();
    
    Logger.info("Bulk collection prep configuration complete", {
      prepCount: collectionPreps.length,
      totalOrders: orders.length,
    });
  } else if (builderMode === "multiple") {
    // Collection prep builder: configure multiple preps
    collectionPreps = [];
    let addMore = true;
    let prepNumber = 1;

    // Determine total number of preps upfront (ask user or use a reasonable default)
    // For now, we'll ask the user how many preps they plan to create
    const plannedPrepCount = await promptService.promptPlannedCollectionPrepCount();
    const totalPreps = plannedPrepCount;

    while (addMore) {
      // Get locationId for selected orders (will be determined from order selection)
      // For auto-allocation, we need to know which locationId the orders belong to
      const prepConfig = await promptService.promptCollectionPrepConfig(
        prepNumber,
        totalPreps,
        carriers,
        orders.length,
      );

      // Determine locationId from selected orders
      // If auto-allocated, determine from the first order's locationId
      // If manually selected, validate all selected orders have the same locationId
      const selectedOrderIndices = prepConfig.orderIndices;
      if (selectedOrderIndices.length === 0) {
        throw new Error("No orders selected for collection prep");
      }

      // Get locationIds for selected orders
      const selectedLocationIds = new Set(
        selectedOrderIndices.map((idx) => orders[idx].locationId).filter(Boolean),
      );

      if (selectedLocationIds.size === 0) {
        throw new Error("Selected orders have no locationId");
      }

      if (selectedLocationIds.size > 1) {
        throw new Error(
          `Selected orders have different locationIds: ${Array.from(selectedLocationIds).join(", ")}. ` +
            `All orders in a collection prep must have the same locationId.`,
        );
      }

      const locationId = Array.from(selectedLocationIds)[0];
      if (!locationId) {
        throw new Error("Cannot determine locationId for collection prep");
      }

      collectionPreps.push({
        carrier: prepConfig.carrier,
        locationId,
        prepDate: new Date(),
        testTag: prepConfig.testTag,
        orderIndices: prepConfig.orderIndices,
      });

      prepNumber++;
      addMore = await promptService.promptAddAnotherCollectionPrep();
    }

    // Validate collection preps
    for (let i = 0; i < collectionPreps.length; i++) {
      const prep = collectionPreps[i];
      const prepOrders = prep.orderIndices
        ? prep.orderIndices.map((idx) => orders[idx])
        : [];
      const validation = validateCollectionPrep(
        i,
        prep.orderIndices || [],
        prepOrders.map((o) => ({ composition: o.composition })),
        false, // PnP config validation would need to be passed in
      );
      if (validation.issues.length > 0) {
        displayValidationIssues(validation.issues);
      }
    }
    
    // Show allocation summary
    console.log();
    console.log(OutputFormatter.header("Collection Prep Allocation Summary", "📊"));
    console.log(OutputFormatter.separator());
    for (let i = 0; i < collectionPreps.length; i++) {
      const prep = collectionPreps[i];
      const orderList = prep.orderIndices
        ? prep.orderIndices.map((idx) => idx + 1).join(", ")
        : "None";
      console.log(
        `   Prep ${i + 1}: ${prep.carrier.name} - Orders: ${orderList} (${prep.orderIndices?.length || 0} orders)`,
      );
    }
    console.log(OutputFormatter.separator());
    console.log();
    
    Logger.info("Multiple collection prep configuration complete", {
      prepCount: collectionPreps.length,
      totalOrders: orders.length,
    });
  } else {
    // Legacy single collection prep mode
    collectionPrepCount = await promptService.promptCollectionPrepCount(orders.length, carriers.length > 0);

    if (collectionPrepCount > 0) {
      carrier = await promptService.promptCarrierSelection(carriers);
      prepDate = new Date();
      testTag = await promptService.promptTestTag();
    }
  }

  return {
    collectionPreps,
    collectionPrepCount,
    carrier,
    prepDate,
    testTag,
  };
}
