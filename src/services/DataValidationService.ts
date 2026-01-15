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

    // Validate PnP configuration if PnP items present
    const hasPnpItems = config.orders.some((order) =>
      order.lineItems.some((item) => item.pickType === PickType.PickAndPack),
    );
    if (hasPnpItems) {
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

    // Query parts by SKU
    const parts = await this.prisma.part.findMany({
      where: {
        sku: { in: Array.from(allSkus) },
        region: config.collectionPrep?.region || "CA", // Use region from collectionPrep or default
      },
      select: {
        sku: true,
      },
    });

    const existingSkus = new Set(parts.map((p) => p.sku));
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
      .filter((type): type is string => type !== undefined);

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

    if (!config.pnpConfig) {
      errors.push("PnP items present but pnpConfig is missing");
      return errors;
    }

    if (!config.pnpConfig.packageInfo || config.pnpConfig.packageInfo.length === 0) {
      errors.push("PnP items present but no packageInfo defined");
    }

    if (!config.pnpConfig.boxes || config.pnpConfig.boxes.length === 0) {
      errors.push("PnP items present but no boxes defined");
    }

    return errors;
  }
}
