import type { Variant } from "../repositories/ConfigDataRepository";
import type { OrderTemplate } from "./InteractivePromptService";
import { InteractivePromptService } from "./InteractivePromptService";

export interface LineItem {
  sku: string;
  quantity: number;
  pickType: "Regular" | "Pick and Pack";
  hasBarcode?: boolean;
}

export interface OrderComposition {
  lineItems: LineItem[];
}

/**
 * Service for building order compositions interactively
 *
 * Handles:
 * - Applying templates to orders
 * - Building custom orders from scratch
 * - Editing template-based orders
 * - Validating order compositions
 */
export class OrderCompositionBuilder {
  constructor(private readonly promptService: InteractivePromptService) {}

  /**
   * Build order composition from a template
   * Allows user to modify quantities or add/remove items
   */
  async buildFromTemplate(
    template: OrderTemplate,
    variants: Variant[],
  ): Promise<OrderComposition> {
    // Start with template line items
    const lineItems: LineItem[] = template.lineItems.map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      pickType: item.pickType,
    }));

    // Allow user to modify
    let done = false;
    while (!done) {
      const shouldModify = await this.promptService.promptConfirm(
        "Would you like to modify this order?",
        false,
      );

      if (!shouldModify) {
        done = true;
        break;
      }

      // For simplicity, we'll use a simpler flow
      // In a full implementation, this would be more interactive with action selection
      const shouldAdd = await this.promptService.promptConfirm("Add new item?", false);
      if (shouldAdd) {
        const selectedVariants = await this.promptService.promptVariantSelection(variants);
        for (const variant of selectedVariants) {
          const quantity = await this.promptService.promptQuantity(variant.sku);
          const pickType = await this.promptService.promptPickType();
          lineItems.push({
            sku: variant.sku,
            quantity,
            pickType,
          });
        }
      }

      const shouldModifyItem = await this.promptService.promptConfirm("Modify existing item?", false);
      if (shouldModifyItem && lineItems.length > 0) {
        // Simplified: modify first item
        // In full implementation, would prompt which item to modify
        const newQuantity = await this.promptService.promptQuantity(lineItems[0].sku);
        lineItems[0].quantity = newQuantity;
      }

      const shouldRemove = await this.promptService.promptConfirm("Remove item?", false);
      if (shouldRemove && lineItems.length > 0) {
        // Simplified: remove first item
        // In full implementation, would prompt which item to remove
        lineItems.shift();
      }

      done = await this.promptService.promptConfirm("Done editing?", true);
    }

    this.validateComposition({ lineItems });

    return { lineItems };
  }

  /**
   * Build custom order composition from scratch
   */
  async buildCustom(variants: Variant[]): Promise<OrderComposition> {
    const lineItems: LineItem[] = [];

    let addMore = true;
    while (addMore) {
      const selectedVariants = await this.promptService.promptVariantSelection(variants);

      for (const variant of selectedVariants) {
        const quantity = await this.promptService.promptQuantity(variant.sku);
        const pickType = await this.promptService.promptPickType();

        lineItems.push({
          sku: variant.sku,
          quantity,
          pickType,
        });
      }

      addMore = await this.promptService.promptConfirm("Add more items to this order?", false);
    }

    this.validateComposition({ lineItems });

    return { lineItems };
  }

  /**
   * Validate order composition
   * Ensures at least one item and all quantities are valid
   */
  validateComposition(composition: OrderComposition): void {
    if (composition.lineItems.length === 0) {
      throw new Error("Order must have at least one line item");
    }

    for (const item of composition.lineItems) {
      if (item.quantity < 1) {
        throw new Error(`Line item ${item.sku} must have quantity >= 1`);
      }
      if (item.pickType !== "Regular" && item.pickType !== "Pick and Pack") {
        throw new Error(`Line item ${item.sku} has invalid pickType: ${item.pickType}`);
      }
    }
  }
}
