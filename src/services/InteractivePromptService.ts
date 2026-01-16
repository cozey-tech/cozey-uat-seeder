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
   * Prompt for variant selection (multi-select with search)
   */
  async promptVariantSelection(variants: Variant[]): Promise<Variant[]> {
    // Group variants by model for better UX
    const groupedVariants = variants.reduce(
      (acc, variant) => {
        const key = `${variant.modelName} - ${variant.colorId}`;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(variant);
        return acc;
      },
      {} as Record<string, Variant[]>,
    );

    const choices: Array<{ name: string; value: string } | { type: string }> = Object.entries(
      groupedVariants,
    ).flatMap(([groupName, groupVariants]) => [
      new inquirer.Separator(`─── ${groupName} ───`) as { type: string },
      ...groupVariants.map((v) => ({
        name: `${v.sku} (${v.modelName}, ${v.colorId})`,
        value: v.id,
      })),
    ]);

    const { variantIds } = await inquirer.prompt<{ variantIds: string[] }>([
      {
        type: "checkbox",
        name: "variantIds",
        message: "Select variants (use space to select, enter to confirm):",
        choices: choices as unknown as Array<{ name: string; value: string } | { type: string }>,
        validate: (input: string[]): boolean | string => {
          if (input.length === 0) {
            return "Please select at least one variant";
          }
          return true;
        },
      } as unknown as Parameters<typeof inquirer.prompt>[0][0],
    ]);

    return variants.filter((v) => variantIds.includes(v.id));
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
