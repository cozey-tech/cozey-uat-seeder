import inquirer from "inquirer";
import { search } from "@inquirer/prompts";
import type { Customer, Variant, Carrier } from "../repositories/ConfigDataRepository";
import type { OrderComposition } from "./OrderCompositionBuilder";

export interface OrderTemplate {
  id: string;
  name: string;
  description: string;
  lineItems: Array<{
    sku: string;
    quantity: number;
    pickType: "Regular" | "Pick and Pack"; // Informational only - variant's pickType from database will be used when building orders
  }>;
}

export interface InventoryCheckResult {
  sufficient: boolean;
  shortages: Array<{
    partId: string;
    sku: string;
    required: number;
    available: number;
    shortfall: number;
  }>;
}

/**
 * Service for interactive prompts using inquirer
 *
 * Provides type-safe wrappers around inquirer prompts for config generation
 */
export class InteractivePromptService {
  /**
   * Prompt for order creation mode
   */
  async promptOrderCreationMode(): Promise<"individual" | "bulk-template" | "quick-duplicate"> {
    const { mode } = await inquirer.prompt<{ mode: "individual" | "bulk-template" | "quick-duplicate" }>([
      {
        type: "list",
        name: "mode",
        message: "How would you like to create orders?",
        choices: [
          { name: "Individual (one at a time)", value: "individual" },
          { name: "Bulk from template (create many from a template)", value: "bulk-template" },
          { name: "Quick duplicate (create one, then duplicate with edits)", value: "quick-duplicate" },
        ],
        default: "individual",
      },
    ]);

    return mode;
  }

  /**
   * Prompt for number of orders to create
   */
  async promptOrderCount(): Promise<number> {
    const { count } = await inquirer.prompt<{ count: string }>([
      {
        type: "input",
        name: "count",
        message: "How many orders would you like to create?",
        default: "1",
        validate: (input: string): boolean | string => {
          const num = parseInt(input, 10);
          if (isNaN(num) || !Number.isInteger(num) || num < 1) {
            return "Please enter a positive integer (minimum 1)";
          }
          if (num > 50) {
            return "Maximum 50 orders allowed";
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    return parseInt(count, 10);
  }

  /**
   * Prompt for region selection
   */
  async promptRegion(): Promise<"CA" | "US"> {
    const { region } = await inquirer.prompt<{ region: "CA" | "US" }>([
      {
        type: "list",
        name: "region",
        message: "Select region:",
        choices: [
          { name: "Canada (CA)", value: "CA" },
          { name: "United States (US)", value: "US" },
        ],
        default: "CA",
      },
    ]);

    return region;
  }

  /**
   * Prompt for customer selection (shows locationId)
   */
  async promptCustomerSelection(customers: Customer[]): Promise<Customer> {
    const { customerId } = await inquirer.prompt<{ customerId: string }>([
      {
        type: "list",
        name: "customerId",
        message: "Select customer (determines FC location):",
        choices: customers.map((c) => ({
          name: `${c.name} (${c.email}) - FC: ${c.locationId}`,
          value: c.id,
        })),
      },
    ]);

    const customer = customers.find((c) => c.id === customerId);
    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    return customer;
  }

  /**
   * Prompt for order composition choice (template vs custom)
   * Only shows template option if templates are available
   * If no templates available, automatically returns "custom" without prompting
   */
  async promptOrderComposition(_variants: Variant[], templates: OrderTemplate[]): Promise<"template" | "custom"> {
    // If no templates available, automatically use custom order
    if (templates.length === 0) {
      return "custom";
    }

    const { compositionType } = await inquirer.prompt<{ compositionType: "template" | "custom" }>([
      {
        type: "list",
        name: "compositionType",
        message: "How would you like to build this order?",
        choices: [
          { name: "Use a template", value: "template" },
          { name: "Build custom order", value: "custom" },
        ],
      },
    ]);

    return compositionType;
  }

  /**
   * Prompt for template selection
   * Throws error if templates array is empty (should not be called in that case)
   */
  async promptTemplateSelection(templates: OrderTemplate[]): Promise<OrderTemplate> {
    if (templates.length === 0) {
      throw new Error("No templates available. Cannot select template.");
    }

    const { templateId } = await inquirer.prompt<{ templateId: string }>([
      {
        type: "list",
        name: "templateId",
        message: "Select order template:",
        choices: templates.map((t) => ({
          name: `${t.name} - ${t.description}`,
          value: t.id,
        })),
      },
    ]);

    const template = templates.find((t) => t.id === templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    return template;
  }

  /**
   * Prompt for variant selection with hierarchical model -> color -> configuration -> variant selection
   *
   * Flow:
   * 1. Search/filter models by name
   * 2. Select a model
   * 3. Select colors for that model
   * 4. Select configurations for that model/color (if applicable)
   * 5. Select variants for that configuration
   * 6. Optionally add more products
   */
  async promptVariantSelection(variants: Variant[]): Promise<Variant[]> {
    // Group variants by model
    const variantsByModel = variants.reduce(
      (acc, variant) => {
        if (!acc[variant.modelName]) {
          acc[variant.modelName] = [];
        }
        acc[variant.modelName].push(variant);
        return acc;
      },
      {} as Record<string, Variant[]>,
    );

    const modelNames = Object.keys(variantsByModel).sort();
    const selectedVariants: Variant[] = [];

    let addMoreProducts = true;

    while (addMoreProducts) {
      // Step 1: Select a model with live search
      const selectedModel = await search({
        message: "Search and select a product/model:",
        source: async (input) => {
          const searchTerm = (input || "").toLowerCase().trim();
          const filtered = modelNames.filter((model) => model.toLowerCase().includes(searchTerm));
          return filtered.map((model) => ({
            name: model,
            value: model,
          }));
        },
        pageSize: 10,
      });

      // Step 3: Get all color variants for the selected model
      const modelVariants = variantsByModel[selectedModel];

      // Group by color
      const variantsByColor = modelVariants.reduce(
        (acc, variant) => {
          if (!acc[variant.colorId]) {
            acc[variant.colorId] = [];
          }
          acc[variant.colorId].push(variant);
          return acc;
        },
        {} as Record<string, Variant[]>,
      );

      const colors = Object.keys(variantsByColor).sort();

      // Step 2: Select color with live search
      const selectedColor = await search({
        message: `Select a color for "${selectedModel}":`,
        source: async (input) => {
          const searchTerm = (input || "").toLowerCase().trim();
          const filtered = colors.filter((color) => color.toLowerCase().includes(searchTerm));
          return filtered.map((color) => ({
            name: color,
            value: color,
          }));
        },
      });

      // Step 5: Get variants for selected model/color and group by configuration
      const colorVariants = variantsByColor[selectedColor];

      // Group by configuration (if available)
      const variantsByConfig = colorVariants.reduce(
        (acc, variant) => {
          const configKey = variant.configuration || "Standard"; // Use "Standard" if no configuration
          if (!acc[configKey]) {
            acc[configKey] = [];
          }
          acc[configKey].push(variant);
          return acc;
        },
        {} as Record<string, Variant[]>,
      );

      const configurations = Object.keys(variantsByConfig).sort();

      // Step 3: Select configuration (if multiple exist, otherwise auto-select)
      let selectedConfig: string;
      if (configurations.length === 1) {
        selectedConfig = configurations[0];
        console.log(
          `📦 Using configuration: ${selectedConfig === "Standard" ? "Standard (no specific configuration)" : selectedConfig}`,
        );
      } else {
        selectedConfig = await search({
          message: `Select a configuration for "${selectedModel}" - "${selectedColor}":`,
          source: async (input) => {
            const searchTerm = (input || "").toLowerCase().trim();
            const filtered = configurations.filter((cfg) => cfg.toLowerCase().includes(searchTerm));
            return filtered.map((cfg) => ({
              name: cfg === "Standard" ? "Standard (no specific configuration)" : cfg,
              value: cfg,
            }));
          },
        });
      }

      // Step 4: Select variants for this configuration (multi-select with live filtering)
      const configVariants = variantsByConfig[selectedConfig];

      // Use searchable multi-select: users can search and select variants one by one
      let selectedVariantSkus: string[] = [];
      let doneSelectingVariants = false;

      while (!doneSelectingVariants) {
        // Show current selection status
        const statusMsg =
          selectedVariantSkus.length > 0 ? ` (${selectedVariantSkus.length} selected - select again to deselect)` : "";

        const selectedSku = await search({
          message: `Search and select variants for "${selectedModel}" - "${selectedColor}"${selectedConfig !== "Standard" ? ` - "${selectedConfig}"` : ""}${statusMsg}:`,
          source: async (input) => {
            const searchTerm = (input || "").toLowerCase().trim();
            const filtered = configVariants.filter(
              (variant) =>
                variant.sku.toLowerCase().includes(searchTerm) ||
                variant.description.toLowerCase().includes(searchTerm),
            );
            return filtered.map((variant) => ({
              name: `${variant.sku} - ${variant.description} [${variant.pickType}]${selectedVariantSkus.includes(variant.sku) ? " ✓" : ""}`,
              value: variant.sku,
            }));
          },
        });

        // Toggle selection (add if not selected, remove if already selected)
        if (selectedVariantSkus.includes(selectedSku)) {
          selectedVariantSkus = selectedVariantSkus.filter((sku) => sku !== selectedSku);
          console.log(`➖ Removed: ${selectedSku} (${selectedVariantSkus.length} selected)`);
        } else {
          selectedVariantSkus.push(selectedSku);
          console.log(`➕ Added: ${selectedSku} (${selectedVariantSkus.length} selected)`);
        }

        // Ask if done selecting variants
        const { done } = await inquirer.prompt<{ done: boolean }>([
          {
            type: "confirm",
            name: "done",
            message:
              selectedVariantSkus.length > 0
                ? `Done selecting variants? (${selectedVariantSkus.length} selected)`
                : "Please select at least one variant. Continue?",
            default: selectedVariantSkus.length > 0,
          },
        ]);

        doneSelectingVariants = done && selectedVariantSkus.length > 0;
      }

      // Add selected variants to the result
      const selected = configVariants.filter((v) => selectedVariantSkus.includes(v.sku));
      selectedVariants.push(...selected);

      console.log(
        `✅ Added ${selected.length} variant(s) from "${selectedModel}" - "${selectedColor}"${selectedConfig !== "Standard" ? ` - "${selectedConfig}"` : ""} (${selectedVariants.length} variant(s) total)`,
      );

      // Step 8: Ask if they want to add another product
      const { addMore } = await inquirer.prompt<{ addMore: boolean }>([
        {
          type: "confirm",
          name: "addMore",
          message: "Would you like to add another product?",
          default: false,
        },
      ]);

      addMoreProducts = addMore;
    }

    if (selectedVariants.length === 0) {
      throw new Error("No variants selected");
    }

    return selectedVariants;
  }

  /**
   * Prompt for quantity of a specific SKU
   */
  async promptQuantity(sku: string, max?: number): Promise<number> {
    const { quantity } = await inquirer.prompt<{ quantity: string }>([
      {
        type: "input",
        name: "quantity",
        message: `Enter quantity for ${sku}:`,
        default: "1",
        validate: (input: string): boolean | string => {
          const num = parseInt(input, 10);
          if (isNaN(num) || !Number.isInteger(num) || num < 1) {
            return "Please enter a positive integer (minimum 1)";
          }
          if (max !== undefined && num > max) {
            return `Maximum quantity is ${max}`;
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    return parseInt(quantity, 10);
  }

  /**
   * Prompt for pick type selection
   */
  async promptPickType(): Promise<"Regular" | "Pick and Pack"> {
    const { pickType } = await inquirer.prompt<{ pickType: "Regular" | "Pick and Pack" }>([
      {
        type: "list",
        name: "pickType",
        message: "Select pick type:",
        choices: [
          { name: "Regular", value: "Regular" },
          { name: "Pick and Pack", value: "Pick and Pack" },
        ],
        default: "Regular",
      },
    ]);

    return pickType;
  }

  /**
   * Prompt for collection prep count with suggestion
   */
  async promptCollectionPrepCount(orderCount: number, hasCarriers: boolean = true): Promise<number> {
    const suggested = Math.max(1, Math.ceil(orderCount / 5)); // Suggest 1 prep per 5 orders

    const { count } = await inquirer.prompt<{ count: string }>([
      {
        type: "input",
        name: "count",
        message: `How many collection preps would you like to create?${!hasCarriers ? " (Enter 0 to skip - no carriers available)" : ""}`,
        default: hasCarriers ? suggested.toString() : "0",
        validate: (input: string): boolean | string => {
          const num = parseInt(input, 10);
          if (isNaN(num) || !Number.isInteger(num) || num < 0) {
            return "Please enter a non-negative integer (minimum 0)";
          }
          if (num > orderCount) {
            return `Cannot have more collection preps than orders (${orderCount})`;
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    return parseInt(count, 10);
  }

  /**
   * Prompt for carrier selection
   */
  async promptCarrierSelection(carriers: Carrier[]): Promise<Carrier> {
    const { carrierId } = await inquirer.prompt<{ carrierId: string }>([
      {
        type: "list",
        name: "carrierId",
        message: "Select carrier:",
        choices: carriers.map((c) => ({
          name: c.name,
          value: c.id,
        })),
      },
    ]);

    const carrier = carriers.find((c) => c.id === carrierId);
    if (!carrier) {
      throw new Error(`Carrier ${carrierId} not found`);
    }

    return carrier;
  }

  /**
   * Prompt for test tag for collection prep naming
   */
  async promptTestTag(): Promise<string> {
    const { testTag } = await inquirer.prompt<{ testTag: string }>([
      {
        type: "input",
        name: "testTag",
        message: "Enter test tag for collection prep name (e.g., 'Outbound_Compliance'):",
        default: "Outbound_Compliance",
        validate: (input: string): boolean | string => {
          const trimmed = input.trim();
          if (!trimmed) {
            return "Test tag cannot be empty";
          }
          // Allow alphanumeric, underscores, and hyphens
          if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
            return "Test tag can only contain letters, numbers, underscores, and hyphens";
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    return testTag;
  }

  /**
   * Prompt for save file location
   */
  async promptSaveLocation(defaultPath: string = "output/seed-config.json"): Promise<string> {
    const { filePath } = await inquirer.prompt<{ filePath: string }>([
      {
        type: "input",
        name: "filePath",
        message: "Where should the config file be saved?",
        default: defaultPath,
        validate: (input: string): boolean | string => {
          if (!input.trim()) {
            return "Please enter a file path";
          }
          if (!input.endsWith(".json")) {
            return "File must have .json extension";
          }
          return true;
        },
      },
    ]);

    return filePath;
  }

  /**
   * Prompt for inventory modification confirmation
   */
  async promptInventoryModification(inventoryCheck: InventoryCheckResult): Promise<boolean> {
    if (inventoryCheck.sufficient) {
      return false; // No modification needed
    }

    console.log("\n⚠️  Inventory Shortages Detected:");
    for (const shortage of inventoryCheck.shortages) {
      console.log(
        `   - ${shortage.sku}: Need ${shortage.required}, Available ${shortage.available} (Shortfall: ${shortage.shortfall})`,
      );
    }

    const { shouldModify } = await inquirer.prompt<{ shouldModify: boolean }>([
      {
        type: "confirm",
        name: "shouldModify",
        message: "Would you like to modify inventory to meet requirements?",
        default: false,
      },
    ]);

    return shouldModify;
  }

  /**
   * Prompt for confirmation (generic)
   */
  async promptConfirm(message: string, defaultAnswer: boolean = false): Promise<boolean> {
    const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
      {
        type: "confirm",
        name: "confirmed",
        message,
        default: defaultAnswer,
      },
    ]);

    return confirmed;
  }

  /**
   * Prompt for template name
   */
  async promptTemplateName(): Promise<string> {
    const { name } = await inquirer.prompt<{ name: string }>([
      {
        type: "input",
        name: "name",
        message: "Enter template name:",
        validate: (input: string): boolean | string => {
          const trimmed = input.trim();
          if (!trimmed) {
            return "Template name cannot be empty";
          }
          if (trimmed.length > 100) {
            return "Template name must be 100 characters or less";
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    return name;
  }

  /**
   * Prompt for template description
   */
  async promptTemplateDescription(): Promise<string> {
    const { description } = await inquirer.prompt<{ description: string }>([
      {
        type: "input",
        name: "description",
        message: "Enter template description:",
        default: "",
        validate: (input: string): boolean | string => {
          if (input.length > 200) {
            return "Template description must be 200 characters or less";
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    return description;
  }

  /**
   * Prompt for template ID
   */
  async promptTemplateId(suggestedId?: string): Promise<string> {
    const { id } = await inquirer.prompt<{ id: string }>([
      {
        type: "input",
        name: "id",
        message: "Enter template ID (used for identification, e.g., 'my-custom-order'):",
        default: suggestedId || "",
        validate: (input: string): boolean | string => {
          const trimmed = input.trim();
          if (!trimmed) {
            return "Template ID cannot be empty";
          }
          // Allow alphanumeric, hyphens, and underscores
          if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
            return "Template ID can only contain letters, numbers, underscores, and hyphens";
          }
          if (trimmed.length > 50) {
            return "Template ID must be 50 characters or less";
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    return id;
  }

  /**
   * Prompt for bulk order count
   */
  async promptBulkOrderCount(max?: number): Promise<number> {
    const { count } = await inquirer.prompt<{ count: string }>([
      {
        type: "input",
        name: "count",
        message: `How many orders would you like to create?${max ? ` (max ${max})` : ""}`,
        default: "10",
        validate: (input: string): boolean | string => {
          const num = parseInt(input, 10);
          if (isNaN(num) || !Number.isInteger(num) || num < 1) {
            return "Please enter a positive integer (minimum 1)";
          }
          if (max !== undefined && num > max) {
            return `Maximum ${max} orders allowed`;
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    return parseInt(count, 10);
  }

  /**
   * Prompt for customer selection for bulk orders (with option to use same customer)
   */
  async promptBulkCustomerSelection(
    customers: Customer[],
    allowSame: boolean = true,
  ): Promise<{ customer: Customer; useSameForAll: boolean }> {
    if (allowSame) {
      const { useSame } = await inquirer.prompt<{ useSame: boolean }>([
        {
          type: "confirm",
          name: "useSame",
          message: "Use the same customer for all orders?",
          default: true,
        },
      ]);

      if (useSame) {
        const customer = await this.promptCustomerSelection(customers);
        return { customer, useSameForAll: true };
      }
    }

    const customer = await this.promptCustomerSelection(customers);
    return { customer, useSameForAll: false };
  }

  /**
   * Prompt for collection prep builder mode
   */
  async promptCollectionPrepBuilderMode(): Promise<"single" | "multiple" | "bulk"> {
    const { mode } = await inquirer.prompt<{ mode: "single" | "multiple" | "bulk" }>([
      {
        type: "list",
        name: "mode",
        message: "How would you like to configure collection preps?",
        choices: [
          { name: "Single collection prep (simple)", value: "single" },
          { name: "Multiple collection preps with different carriers (builder)", value: "multiple" },
          { name: "Bulk create multiple preps (same config, vary carriers)", value: "bulk" },
        ],
        default: "single",
      },
    ]);

    return mode;
  }

  /**
   * Prompt for bulk collection prep configuration
   */
  async promptBulkCollectionPrepConfig(
    carriers: Carrier[],
    orderCount: number,
  ): Promise<{
    count: number;
    baseTestTag: string;
    carrierMode: "same" | "different";
    carriers: Carrier[];
  }> {
    const { count } = await inquirer.prompt<{ count: string }>([
      {
        type: "input",
        name: "count",
        message: "How many collection preps would you like to create?",
        default: "3",
        validate: (input: string): boolean | string => {
          const num = parseInt(input, 10);
          if (isNaN(num) || !Number.isInteger(num) || num < 1) {
            return "Please enter a positive integer (minimum 1)";
          }
          if (num > orderCount) {
            return `Cannot have more collection preps than orders (${orderCount})`;
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    const prepCount = parseInt(count, 10);
    const baseTestTag = await this.promptTestTag();

    const { carrierMode } = await inquirer.prompt<{ carrierMode: "same" | "different" }>([
      {
        type: "list",
        name: "carrierMode",
        message: "How should carriers be assigned?",
        choices: [
          { name: "Same carrier for all preps", value: "same" },
          { name: "Different carrier per prep", value: "different" },
        ],
        default: "same",
      },
    ]);

    let selectedCarriers: Carrier[];
    if (carrierMode === "same") {
      const carrier = await this.promptCarrierSelection(carriers);
      selectedCarriers = Array(prepCount).fill(carrier);
    } else {
      // Select carriers for each prep
      selectedCarriers = [];
      for (let i = 0; i < prepCount; i++) {
        console.log(`\nSelect carrier for Prep ${i + 1} of ${prepCount}:`);
        const carrier = await this.promptCarrierSelection(carriers);
        selectedCarriers.push(carrier);
      }
    }

    return {
      count: prepCount,
      baseTestTag,
      carrierMode,
      carriers: selectedCarriers,
    };
  }

  /**
   * Prompt for collection prep configuration (for builder)
   */
  async promptCollectionPrepConfig(
    prepNumber: number,
    totalPreps: number,
    carriers: Carrier[],
    orderCount: number,
  ): Promise<{
    carrier: Carrier;
    testTag: string;
    orderIndices: number[];
  }> {
    console.log(`\n📋 Configuring Collection Prep ${prepNumber} of ${totalPreps}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const carrier = await this.promptCarrierSelection(carriers);
    const testTag = await this.promptTestTag();

    // Show order allocation options
    const { allocationType } = await inquirer.prompt<{ allocationType: "auto" | "manual" }>([
      {
        type: "list",
        name: "allocationType",
        message: "How should orders be allocated to this collection prep?",
        choices: [
          { name: "Auto (round-robin)", value: "auto" },
          { name: "Manual (select specific orders)", value: "manual" },
        ],
        default: "auto",
      },
    ]);

    let orderIndices: number[];
    if (allocationType === "auto") {
      // Round-robin allocation
      orderIndices = [];
      for (let i = prepNumber - 1; i < orderCount; i += totalPreps) {
        orderIndices.push(i);
      }
      console.log(`   ✓ Auto-allocated orders: ${orderIndices.map((i) => i + 1).join(", ")}`);
    } else {
      // Manual selection
      const result = await inquirer.prompt<{ selectedOrders: number[] }>([
        {
          type: "checkbox",
          name: "selectedOrders",
          message: "Select orders for this collection prep:",
          choices: Array.from({ length: orderCount }, (_, i) => ({
            name: `Order ${i + 1}`,
            value: i,
          })),
          validate: (input: unknown): boolean | string => {
            if (!Array.isArray(input) || input.length === 0) {
              return "Please select at least one order";
            }
            return true;
          },
        },
      ]);
      orderIndices = result.selectedOrders;
      console.log(`   ✓ Selected orders: ${orderIndices.map((i) => i + 1).join(", ")}`);
    }

    return {
      carrier,
      testTag,
      orderIndices,
    };
  }

  /**
   * Prompt for planned number of collection preps (for round-robin allocation)
   */
  async promptPlannedCollectionPrepCount(): Promise<number> {
    const { count } = await inquirer.prompt<{ count: string }>([
      {
        type: "input",
        name: "count",
        message: "How many collection preps do you plan to create? (needed for round-robin allocation)",
        default: "1",
        validate: (input: string): boolean | string => {
          const num = parseInt(input, 10);
          if (isNaN(num) || !Number.isInteger(num) || num < 1) {
            return "Please enter a positive integer (minimum 1)";
          }
          if (num > 50) {
            return "Maximum 50 collection preps allowed";
          }
          return true;
        },
        filter: (input: string): string => input.trim(),
      },
    ]);

    return parseInt(count, 10);
  }

  /**
   * Prompt to add another collection prep
   */
  async promptAddAnotherCollectionPrep(): Promise<boolean> {
    const { addMore } = await inquirer.prompt<{ addMore: boolean }>([
      {
        type: "confirm",
        name: "addMore",
        message: "Would you like to add another collection prep?",
        default: false,
      },
    ]);

    return addMore;
  }

  /**
   * Display order review summary and prompt for action
   */
  async promptOrderReviewAction(
    orders: Array<{ customer: Customer; composition: OrderComposition }>,
  ): Promise<"continue" | "add-more" | "edit" | "delete" | "start-over"> {
    // Display summary
    console.log("\n📋 Order Review");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Total Orders: ${orders.length}\n`);

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const itemCount = order.composition.lineItems.length;
      const totalItems = order.composition.lineItems.reduce(
        (sum: number, item: { quantity: number }) => sum + item.quantity,
        0,
      );
      console.log(`   Order ${i + 1}: ${order.customer.name} (${order.customer.email})`);
      console.log(`            Location: ${order.customer.locationId}`);
      console.log(`            Items: ${itemCount} line items, ${totalItems} total quantity`);
      console.log("");
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const { action } = await inquirer.prompt<{ action: "continue" | "add-more" | "edit" | "delete" | "start-over" }>([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "Continue to collection prep configuration", value: "continue" },
          { name: "Add more orders", value: "add-more" },
          { name: "Edit an order", value: "edit" },
          { name: "Delete an order", value: "delete" },
          { name: "Start over", value: "start-over" },
        ],
        default: "continue",
      },
    ]);

    return action;
  }

  /**
   * Prompt for which order to edit
   */
  async promptOrderToEdit(orderCount: number): Promise<number> {
    const { orderIndex } = await inquirer.prompt<{ orderIndex: number }>([
      {
        type: "list",
        name: "orderIndex",
        message: "Which order would you like to edit?",
        choices: Array.from({ length: orderCount }, (_, i) => ({
          name: `Order ${i + 1}`,
          value: i,
        })),
      },
    ]);

    return orderIndex;
  }

  /**
   * Prompt for which order to delete
   */
  async promptOrderToDelete(orderCount: number): Promise<number> {
    const { orderIndex } = await inquirer.prompt<{ orderIndex: number }>([
      {
        type: "list",
        name: "orderIndex",
        message: "Which order would you like to delete?",
        choices: Array.from({ length: orderCount }, (_, i) => ({
          name: `Order ${i + 1}`,
          value: i,
        })),
      },
    ]);

    return orderIndex;
  }
}
