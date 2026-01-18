/**
 * Order creation flows for config generator
 */

import type { Customer, Variant, Location } from "../../repositories/ConfigDataRepository";
import type { OrderComposition } from "../../services/OrderCompositionBuilder";
import type { OrderTemplate } from "../../services/InteractivePromptService";
import { InteractivePromptService } from "../../services/InteractivePromptService";
import { OrderCompositionBuilder } from "../../services/OrderCompositionBuilder";
import { InventoryService } from "../../services/InventoryService";
import { OutputFormatter } from "../../utils/outputFormatter";
import { loadOrderTemplates, saveTemplate, filterValidTemplates } from "../initialization";

export interface Order {
  customer: Customer;
  composition: OrderComposition;
  locationId: string;
}

export interface InventoryCheck {
  orderIndex: number;
  composition: OrderComposition;
  customer: Customer;
  locationId: string;
}

export interface OrderCreationOptions {
  modifyInventory: boolean;
  skipSaveTemplate: boolean;
}

export interface OrderCreationContext {
  variants: Variant[];
  customers: Customer[];
  templates: OrderTemplate[];
  locationsCache: Map<string, Location>;
  region: "CA" | "US";
  promptService: InteractivePromptService;
  compositionBuilder: OrderCompositionBuilder;
  inventoryService: InventoryService;
}

export interface OrderCreationResult {
  orders: Order[];
  inventoryChecks: InventoryCheck[];
  updatedTemplates?: OrderTemplate[];
}

/**
 * Create orders based on selected mode
 */
export async function createOrders(
  context: OrderCreationContext,
  options: OrderCreationOptions,
): Promise<OrderCreationResult> {
  const { variants, customers, templates, locationsCache, region, promptService, compositionBuilder, inventoryService } = context;
  
  // Prompt for order creation mode
  const creationMode = await promptService.promptOrderCreationMode();

  const orders: Order[] = [];
  let inventoryChecks: InventoryCheck[] = [];

  if (creationMode === "individual") {
    // Individual mode: original flow
    const orderCount = await promptService.promptOrderCount();
    for (let i = 0; i < orderCount; i++) {
      console.log();
      console.log(OutputFormatter.progress(i + 1, orderCount, "Building Order"));
      console.log(OutputFormatter.separator());

      // Select customer
      const customer = await promptService.promptCustomerSelection(customers);
      // Use cached location (batched lookup)
      const location = locationsCache.get(customer.id);
      if (!location) {
        throw new Error(`Location not found for customer ${customer.id}`);
      }
      // Location is validated but not used directly - customer.locationId is used

      // Select order composition method (automatically uses custom if no templates available)
      const compositionType = await promptService.promptOrderComposition(variants, templates);

      let composition: OrderComposition;
      if (compositionType === "template") {
        const template = await promptService.promptTemplateSelection(templates);
        composition = await compositionBuilder.buildFromTemplate(template, variants);
      } else {
        // Build custom order
        composition = await compositionBuilder.buildCustom(variants);
        
        // Offer to save custom order as template (unless skipped)
        if (!options.skipSaveTemplate) {
          const shouldSave = await promptService.promptConfirm(
            "Would you like to save this order as a template for future use?",
            false,
          );
          
          if (shouldSave) {
            console.log("\n💾 Saving order as template...");
            const templateName = await promptService.promptTemplateName();
            const templateDescription = await promptService.promptTemplateDescription();
            
            // Generate suggested ID from name
            const suggestedId = templateName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
            
            const templateId = await promptService.promptTemplateId(suggestedId);
            
            // Create template from composition
            const newTemplate: OrderTemplate = {
              id: templateId,
              name: templateName,
              description: templateDescription || `Custom order: ${templateName}`,
              lineItems: composition.lineItems.map((item) => ({
                sku: item.sku,
                quantity: item.quantity,
                pickType: item.pickType, // Informational only - will use variant's pickType when used
              })),
            };
            
            saveTemplate(newTemplate);
            
            // Reload templates to include the new one
            const updatedTemplates = loadOrderTemplates();
            const validUpdatedTemplates = filterValidTemplates(updatedTemplates, variants);
            
            // Return updated templates so caller can use them
            return {
              orders,
              inventoryChecks,
              updatedTemplates: validUpdatedTemplates,
            };
          }
        }
      }

      // Defer inventory check for bulk operations
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
    }
  } else if (creationMode === "bulk-template") {
    // Bulk template mode
    if (templates.length === 0) {
      throw new Error("No templates available. Please create a template first or use individual mode.");
    }

    const template = await promptService.promptTemplateSelection(templates);
    const bulkCount = await promptService.promptBulkOrderCount(50);
    const { customer: baseCustomer, useSameForAll } = await promptService.promptBulkCustomerSelection(
      customers,
      true,
    );

    // Validate baseCustomer location exists (consistent with other modes)
    const baseLocation = locationsCache.get(baseCustomer.id);
    if (!baseLocation) {
      throw new Error(`Location not found for customer ${baseCustomer.id} (${baseCustomer.name})`);
    }

    console.log(`\n📦 Creating ${bulkCount} orders from template "${template.name}"...`);

    // Create variant map for pickType lookup
    const variantMap = new Map<string, Variant>();
    for (const variant of variants) {
      variantMap.set(variant.sku, variant);
    }

    for (let i = 0; i < bulkCount; i++) {
      // Select customer (if not using same for all)
      const customer = useSameForAll
        ? baseCustomer
        : await promptService.promptCustomerSelection(customers);

      // Validate customer location exists (if not using same for all, validate each customer)
      if (!useSameForAll) {
        const location = locationsCache.get(customer.id);
        if (!location) {
          throw new Error(`Location not found for customer ${customer.id} (${customer.name})`);
        }
      }

      // Build composition from template
      const lineItems = template.lineItems.map((item) => {
        const variant = variantMap.get(item.sku);
        if (!variant) {
          throw new Error(`Variant not found for SKU ${item.sku} in template`);
        }
        return {
          sku: item.sku,
          quantity: item.quantity,
          pickType: variant.pickType,
        };
      });

      const composition: OrderComposition = { lineItems };

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

      if ((i + 1) % 10 === 0) {
        console.log(`   ✓ Created ${i + 1} of ${bulkCount} orders...`);
      }
    }

    console.log(`✅ Created ${bulkCount} orders from template\n`);
  } else if (creationMode === "quick-duplicate") {
    // Quick duplicate mode: create first order, then duplicate with edits
    console.log("\n📦 Create your first order (this will be used as a template):");
    console.log(OutputFormatter.separator());

    // Create first order
    const firstCustomer = await promptService.promptCustomerSelection(customers);
    const firstLocation = locationsCache.get(firstCustomer.id);
    if (!firstLocation) {
      throw new Error(`Location not found for customer ${firstCustomer.id}`);
    }

    const firstCompositionType = await promptService.promptOrderComposition(variants, templates);
    let firstComposition: OrderComposition;
    if (firstCompositionType === "template") {
      const template = await promptService.promptTemplateSelection(templates);
      firstComposition = await compositionBuilder.buildFromTemplate(template, variants);
    } else {
      firstComposition = await compositionBuilder.buildCustom(variants);
    }

    if (options.modifyInventory) {
      inventoryChecks.push({
        orderIndex: orders.length,
        composition: firstComposition,
        customer: firstCustomer,
        locationId: firstCustomer.locationId,
      });
    }

    orders.push({
      customer: firstCustomer,
      composition: firstComposition,
      locationId: firstCustomer.locationId,
    });

    console.log(OutputFormatter.success("First order created\n"));

    // Duplicate and edit
    let duplicateMore = true;
    while (duplicateMore) {
      const shouldDuplicate = await promptService.promptConfirm(
        "Would you like to duplicate this order with edits?",
        true,
      );

      if (!shouldDuplicate) {
        duplicateMore = false;
        break;
      }

      const duplicateCustomer = await promptService.promptCustomerSelection(customers);
      const duplicateLocation = locationsCache.get(duplicateCustomer.id);
      if (!duplicateLocation) {
        throw new Error(`Location not found for customer ${duplicateCustomer.id}`);
      }

      // Allow editing the composition
      const shouldEdit = await promptService.promptConfirm(
        "Would you like to edit the order composition?",
        false,
      );

      let duplicateComposition: OrderComposition;
      if (shouldEdit) {
        // Rebuild from template or custom
        const editCompositionType = await promptService.promptOrderComposition(variants, templates);
        if (editCompositionType === "template") {
          const template = await promptService.promptTemplateSelection(templates);
          duplicateComposition = await compositionBuilder.buildFromTemplate(template, variants);
        } else {
          duplicateComposition = await compositionBuilder.buildCustom(variants);
        }
      } else {
        // Use same composition
        duplicateComposition = { ...firstComposition };
      }

      if (options.modifyInventory) {
        inventoryChecks.push({
          orderIndex: orders.length,
          composition: duplicateComposition,
          customer: duplicateCustomer,
          locationId: duplicateCustomer.locationId,
        });
      }

      orders.push({
        customer: duplicateCustomer,
        composition: duplicateComposition,
        locationId: duplicateCustomer.locationId,
      });

      console.log(OutputFormatter.success(`Duplicated order (${orders.length} total)\n`));
    }
  }

  // Batch inventory checks at the end (if enabled)
  if (options.modifyInventory && inventoryChecks.length > 0) {
    const inventoryCheckStart = Date.now();
    console.log("\n🔍 Checking inventory for all orders...");
    for (const check of inventoryChecks) {
      const compositionSkus = check.composition.lineItems.map((item) => item.sku);
      const compositionVariants = variants.filter((v) => compositionSkus.includes(v.sku));

      const variantQuantities = new Map<string, number>();
      for (const item of check.composition.lineItems) {
        const existingQuantity = variantQuantities.get(item.sku) || 0;
        variantQuantities.set(item.sku, existingQuantity + item.quantity);
      }

      const inventoryCheck = await inventoryService.checkInventoryAvailability(
        compositionVariants,
        check.locationId,
        region,
        variantQuantities,
      );

      if (!inventoryCheck.sufficient) {
        console.log();
        console.log(OutputFormatter.warning(`Order ${check.orderIndex + 1} has inventory shortages:`));
        const shouldModify = await promptService.promptInventoryModification(inventoryCheck);
        if (shouldModify) {
          await inventoryService.ensureInventoryForOrder(
            check.composition,
            check.locationId,
            region,
          );
          console.log(OutputFormatter.success(`Inventory updated for order ${check.orderIndex + 1}`));
        }
      }
    }
    const inventoryCheckTime = Date.now() - inventoryCheckStart;
    console.log(OutputFormatter.success(`Inventory checks complete (${OutputFormatter.duration(inventoryCheckTime)} for ${inventoryChecks.length} orders)\n`));
  }

  return { 
    orders, 
    inventoryChecks,
  };
}
