import inquirer from "inquirer";
import type { Customer, Variant, Carrier } from "../repositories/ConfigDataRepository";

export interface OrderTemplate {
  id: string;
  name: string;
  description: string;
  lineItems: Array<{
    sku: string;
    quantity: number;
    pickType: "Regular" | "Pick and Pack";
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
   */
  async promptOrderComposition(
    _variants: Variant[],
    _templates: OrderTemplate[],
  ): Promise<"template" | "custom"> {
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
   */
  async promptTemplateSelection(templates: OrderTemplate[]): Promise<OrderTemplate> {
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
    let searchTerm = "";

    while (addMoreProducts) {
      // Step 1: Search/filter models
      const { searchInput } = await inquirer.prompt<{ searchInput: string }>([
        {
          type: "input",
          name: "searchInput",
          message: "Search for a product/model (press Enter to see all, or type to filter):",
          default: searchTerm,
          filter: (input: string): string => input.trim(),
        },
      ]);

      searchTerm = searchInput.toLowerCase();

      // Filter models based on search
      const filteredModels = modelNames.filter((model) =>
        model.toLowerCase().includes(searchTerm),
      );

      if (filteredModels.length === 0) {
        console.log("❌ No models found matching your search. Please try again.");
        continue;
      }

      // Step 2: Select a model
      const { selectedModel } = await inquirer.prompt<{ selectedModel: string }>([
        {
          type: "list",
          name: "selectedModel",
          message: `Select a product/model${searchTerm ? ` (filtered: "${searchTerm}")` : ""}:`,
          choices: filteredModels.map((model) => ({
            name: model,
            value: model,
          })),
          pageSize: 10,
        },
      ]);

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

      // Step 4: Select colors for this model
      const { selectedColor } = await inquirer.prompt<{ selectedColor: string }>([
        {
          type: "list",
          name: "selectedColor",
          message: `Select a color for "${selectedModel}":`,
          choices: colors.map((color) => ({
            name: color,
            value: color,
          })),
        },
      ]);

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

      // Step 6: Select configuration (if multiple exist, otherwise auto-select)
      let selectedConfig: string;
      if (configurations.length === 1) {
        selectedConfig = configurations[0];
        console.log(`📦 Using configuration: ${selectedConfig === "Standard" ? "Standard (no specific configuration)" : selectedConfig}`);
      } else {
        const { config } = await inquirer.prompt<{ config: string }>([
          {
            type: "list",
            name: "config",
            message: `Select a configuration for "${selectedModel}" - "${selectedColor}":`,
            choices: configurations.map((cfg) => ({
              name: cfg === "Standard" ? "Standard (no specific configuration)" : cfg,
              value: cfg,
            })),
          },
        ]);
        selectedConfig = config;
      }

      // Step 7: Select variants for this configuration (multi-select)
      const configVariants = variantsByConfig[selectedConfig];
      const { selectedVariantSkus } = await inquirer.prompt<{ selectedVariantSkus: string[] }>([
        {
          type: "checkbox",
          name: "selectedVariantSkus",
          message: `Select variants for "${selectedModel}" - "${selectedColor}"${selectedConfig !== "Standard" ? ` - "${selectedConfig}"` : ""}:`,
          choices: configVariants.map((variant) => ({
            name: `${variant.sku} - ${variant.description} [${variant.pickType}]`,
            value: variant.sku,
          })),
          validate: (input: string[]): boolean | string => {
            if (input.length === 0) {
              return "Please select at least one variant";
            }
            return true;
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]);

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
      searchTerm = ""; // Reset search for next product
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
  async promptCollectionPrepCount(orderCount: number): Promise<number> {
    const suggested = Math.max(1, Math.ceil(orderCount / 5)); // Suggest 1 prep per 5 orders

    const { count } = await inquirer.prompt<{ count: string }>([
      {
        type: "input",
        name: "count",
        message: `How many collection preps would you like to create?`,
        default: suggested.toString(),
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
   * Prompt for save file location
   */
  async promptSaveLocation(defaultPath: string = "seed-config.json"): Promise<string> {
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
}
