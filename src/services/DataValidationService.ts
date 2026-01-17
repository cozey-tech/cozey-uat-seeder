import { PrismaClient } from "@prisma/client";
import type { SeedConfig } from "../shared/types/SeedConfig";
import { PickType } from "../shared/enums/PickType";

export class DataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataValidationError";
    Object.setPrototypeOf(this, DataValidationError.prototype);
  }
}

export class DataValidationService {
  constructor(private readonly prisma: PrismaClient) {}

  async validateSeedConfig(config: SeedConfig): Promise<void> {
    const errors: string[] = [];

    // Validate SKUs exist in WMS
    const skuValidationErrors = await this.validateSkusExist(config);
    errors.push(...skuValidationErrors);

    // Validate customer data format
    const customerValidationErrors = this.validateCustomerData(config);
    errors.push(...customerValidationErrors);

    // Validate line item quantities
    const quantityValidationErrors = this.validateLineItemQuantities(config);
    errors.push(...quantityValidationErrors);

    // Validate order relationships (if collectionPrep specified)
    if (config.collectionPrep) {
      const orderMixErrors = this.validateOrderMix(config);
      errors.push(...orderMixErrors);
    }

    // Note: pnpConfig is optional - boxes already exist in the database
    // If pnpConfig is provided, validate it, but don't require it for PnP items
    if (config.pnpConfig) {
      const pnpConfigErrors = this.validatePnpConfig(config);
      errors.push(...pnpConfigErrors);
    }

    if (errors.length > 0) {
      throw new DataValidationError(`Data validation failed:\n${errors.join("\n")}`);
    }
  }

  private async validateSkusExist(config: SeedConfig): Promise<string[]> {
    const errors: string[] = [];
    const allSkus = new Set<string>();

    // Collect all unique SKUs
    for (const order of config.orders) {
      for (const lineItem of order.lineItems) {
        allSkus.add(lineItem.sku);
      }
    }

    // Query variants by SKU (config uses variant SKUs, not part SKUs)
    const region = config.region || config.collectionPrep?.region || "CA";
    const variants = await this.prisma.variant.findMany({
      where: {
        sku: { in: Array.from(allSkus) },
        region,
        disabled: false,
      },
      select: {
        sku: true,
      },
    });

    const existingSkus = new Set(variants.map((v) => v.sku));
    const missingSkus = Array.from(allSkus).filter((sku) => !existingSkus.has(sku));

    if (missingSkus.length > 0) {
      errors.push(`Missing SKUs in WMS: ${missingSkus.join(", ")}`);
    }

    return errors;
  }

  private validateCustomerData(config: SeedConfig): string[] {
    const errors: string[] = [];

    for (let i = 0; i < config.orders.length; i++) {
      const order = config.orders[i];
      if (!order.customer.name || order.customer.name.trim().length === 0) {
        errors.push(`Order ${i + 1}: Customer name is required`);
      }
      // Email format is already validated by Zod schema, but check for @example.com pattern
      if (order.customer.email && !order.customer.email.includes("@")) {
        errors.push(`Order ${i + 1}: Invalid email format: ${order.customer.email}`);
      }
    }

    return errors;
  }

  private validateLineItemQuantities(config: SeedConfig): string[] {
    const errors: string[] = [];

    for (let i = 0; i < config.orders.length; i++) {
      const order = config.orders[i];
      for (let j = 0; j < order.lineItems.length; j++) {
        const lineItem = order.lineItems[j];
        if (lineItem.quantity <= 0) {
          errors.push(`Order ${i + 1}, Line Item ${j + 1}: Quantity must be positive`);
        }
      }
    }

    return errors;
  }

  private validateOrderMix(config: SeedConfig): string[] {
    const errors: string[] = [];

    // Check if we have the required mix (if orderType is specified)
    const orderTypes = config.orders
      .map((order) => order.orderType)
      .filter((type): type is "regular-only" | "pnp-only" | "mixed" => type !== undefined);

    if (orderTypes.length === 0) {
      // No orderType specified, skip validation
      return errors;
    }

    const hasRegularOnly = orderTypes.includes("regular-only");
    const hasPnpOnly = orderTypes.includes("pnp-only");
    const hasMixed = orderTypes.includes("mixed");

    // If collectionPrep is specified, we expect at least one of each type
    // But this is flexible - just warn if mix is not ideal
    if (!hasRegularOnly && !hasPnpOnly && !hasMixed) {
      errors.push(
        "Collection Prep specified but no order types defined. Consider specifying orderType for each order.",
      );
    }

    return errors;
  }

  private validatePnpConfig(config: SeedConfig): string[] {
    const errors: string[] = [];

    // Only validate if pnpConfig is provided (it's optional)
    if (!config.pnpConfig) {
      return errors;
    }

    if (!config.pnpConfig.packageInfo || config.pnpConfig.packageInfo.length === 0) {
      errors.push("pnpConfig provided but no packageInfo defined");
    }

    if (!config.pnpConfig.boxes || config.pnpConfig.boxes.length === 0) {
      errors.push("pnpConfig provided but no boxes defined");
    }

    return errors;
  }
}
