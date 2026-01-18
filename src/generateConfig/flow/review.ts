/**
 * Order review flows for config generator
 */

import type { Customer, Variant, Location } from "../../repositories/ConfigDataRepository";
import type { OrderComposition } from "../../services/OrderCompositionBuilder";
import type { OrderTemplate } from "../../services/InteractivePromptService";
import { InteractivePromptService } from "../../services/InteractivePromptService";
import { OrderCompositionBuilder } from "../../services/OrderCompositionBuilder";
import { OutputFormatter } from "../../utils/outputFormatter";
import { Logger } from "../../utils/logger";
import type { Order, InventoryCheck } from "./orderCreation";
import { validateOrder, displayValidationIssues, getValidationSummary } from "./validation";

export interface ReviewContext {
  variants: Variant[];
  customers: Customer[];
  templates: OrderTemplate[];
  locationsCache: Map<string, Location>;
  promptService: InteractivePromptService;
  compositionBuilder: OrderCompositionBuilder;
}

export interface ReviewOptions {
  modifyInventory: boolean;
}

/**
 * Handle order review loop
 */
export async function reviewOrders(
  orders: Order[],
  inventoryChecks: InventoryCheck[],
  context: ReviewContext,
  options: ReviewOptions,
): Promise<{ orders: Order[]; inventoryChecks: InventoryCheck[] }> {
  const { variants, customers, templates, locationsCache, promptService, compositionBuilder } = context;

  // Show validation summary at start of review
  const validationSummary = getValidationSummary(
    orders.map((o) => ({ composition: o.composition })),
    variants,
  );

  if (validationSummary.errorCount > 0 || validationSummary.warningCount > 0) {
    console.log();
    console.log(OutputFormatter.header("Validation Summary", "🔍"));
    console.log(OutputFormatter.separator());
    console.log(OutputFormatter.keyValue("Errors", validationSummary.errorCount));
    console.log(OutputFormatter.keyValue("Warnings", validationSummary.warningCount));
    console.log();

    if (validationSummary.errorCount > 0) {
      displayValidationIssues(validationSummary.issues);
      Logger.warn("Config has validation errors", {
        errorCount: validationSummary.errorCount,
        warningCount: validationSummary.warningCount,
      });
    }
  }

  let reviewComplete = false;
  while (!reviewComplete) {
    const reviewAction = await promptService.promptOrderReviewAction(orders);

    if (reviewAction === "continue") {
      reviewComplete = true;
    } else if (reviewAction === "add-more") {
      // Add more orders using the same creation mode
      Logger.info("Adding more orders", { currentOrderCount: orders.length });
      // Reuse the creation mode logic (simplified - just add one more order)
      const customer = await promptService.promptCustomerSelection(customers);
      const location = locationsCache.get(customer.id);
      if (!location) {
        throw new Error(`Location not found for customer ${customer.id}`);
      }

      const compositionType = await promptService.promptOrderComposition(variants, templates);
      let composition: OrderComposition;
      if (compositionType === "template") {
        const template = await promptService.promptTemplateSelection(templates);
        composition = await compositionBuilder.buildFromTemplate(template, variants);
      } else {
        composition = await compositionBuilder.buildCustom(variants);
      }

      // Validate order before adding
      const validation = validateOrder(orders.length, composition, variants, customer.email);
      if (!validation.valid) {
        displayValidationIssues(validation.issues);
        Logger.warn("Order validation failed when adding", {
          orderIndex: orders.length,
          customerEmail: customer.email,
          issues: validation.issues,
        });
      } else if (validation.issues.length > 0) {
        displayValidationIssues(validation.issues);
      }

      if (options.modifyInventory) {
        inventoryChecks.push({
          orderIndex: orders.length,
          composition,
          customer,
          locationId: customer.locationId,
        });
      }

      orders.push({
        customer,
        composition,
        locationId: customer.locationId,
      });
      Logger.info("Order added", { totalOrders: orders.length });
    } else if (reviewAction === "edit") {
      if (orders.length === 0) {
        Logger.warn("No orders to edit", { orderCount: orders.length });
        continue;
      }
      const orderIndex = await promptService.promptOrderToEdit(orders.length);
      Logger.info("Editing order", { orderIndex: orderIndex + 1, totalOrders: orders.length });

      // Rebuild the order
      const customer = await promptService.promptCustomerSelection(customers);
      const location = locationsCache.get(customer.id);
      if (!location) {
        throw new Error(`Location not found for customer ${customer.id}`);
      }

      const compositionType = await promptService.promptOrderComposition(variants, templates);
      let composition: OrderComposition;
      if (compositionType === "template") {
        const template = await promptService.promptTemplateSelection(templates);
        composition = await compositionBuilder.buildFromTemplate(template, variants);
      } else {
        composition = await compositionBuilder.buildCustom(variants);
      }

      // Validate edited order
      const validation = validateOrder(orderIndex, composition, variants, customer.email);
      if (!validation.valid) {
        displayValidationIssues(validation.issues);
        Logger.warn("Edited order validation failed", {
          orderIndex,
          customerEmail: customer.email,
          issues: validation.issues,
        });
      } else if (validation.issues.length > 0) {
        displayValidationIssues(validation.issues);
      }

      // Update inventory check if needed
      if (options.modifyInventory) {
        // Remove old check, add new one
        inventoryChecks = inventoryChecks.filter((check) => check.orderIndex !== orderIndex);
        inventoryChecks.push({
          orderIndex,
          composition,
          customer,
          locationId: customer.locationId,
        });
      }

      orders[orderIndex] = {
        customer,
        composition,
        locationId: customer.locationId,
      };
      Logger.info("Order updated", { orderIndex: orderIndex + 1 });
    } else if (reviewAction === "delete") {
      if (orders.length === 0) {
        console.log(OutputFormatter.warning("No orders to delete."));
        console.log();
        continue;
      }
      if (orders.length === 1) {
        console.log(OutputFormatter.warning("Cannot delete the last order. Please add more orders first."));
        console.log();
        continue;
      }
      const orderIndex = await promptService.promptOrderToDelete(orders.length);
      const confirmDelete = await promptService.promptConfirm(
        `Are you sure you want to delete Order ${orderIndex + 1}?`,
        false,
      );

      if (confirmDelete) {
        orders.splice(orderIndex, 1);
        // Update inventory check indices
        if (options.modifyInventory) {
          inventoryChecks = inventoryChecks
            .filter((check) => check.orderIndex !== orderIndex)
            .map((check) => ({
              ...check,
              orderIndex: check.orderIndex > orderIndex ? check.orderIndex - 1 : check.orderIndex,
            }));
        }
        console.log(OutputFormatter.success(`Deleted order ${orderIndex + 1}\n`));
      }
    } else if (reviewAction === "start-over") {
      const confirmStartOver = await promptService.promptConfirm(
        "Are you sure you want to start over? All current orders will be lost.",
        false,
      );

      if (confirmStartOver) {
        orders.length = 0;
        inventoryChecks.length = 0;
        console.log(OutputFormatter.info("Starting over...\n"));
        // Exit and let user restart manually
        console.log("Please run the command again to start over.");
        process.exit(0);
      }
    }
  }

  return { orders, inventoryChecks };
}
