import type { SeedConfig } from "../shared/types/SeedConfig";
import { seedConfigSchema } from "../shared/validation/seedConfigSchema";
import { DataValidationService } from "./DataValidationService";
import { PrismaClient } from "@prisma/client";
import type { ConfigDataRepository } from "../repositories/ConfigDataRepository";
import { carriers } from "../shared/carriers";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Service for validating generated configs against Shopify API and DB schemas
 *
 * Handles:
 * - Shopify API alignment validation
 * - Database schema alignment validation
 * - Combined validation with existing Zod schema
 */
export class ConfigValidationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dataRepository: ConfigDataRepository,
    private readonly dataValidationService: DataValidationService,
  ) {}

  /**
   * Validate full config (Zod + Shopify + DB)
   */
  async validateFull(config: SeedConfig): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // 1. Zod schema validation
    const zodResult = seedConfigSchema.safeParse(config);
    if (!zodResult.success) {
      result.valid = false;
      result.errors.push(...zodResult.error.errors.map((e) => `Schema validation: ${e.path.join(".")} - ${e.message}`));
      return result; // Stop here if schema is invalid
    }

    // 2. Shopify API alignment
    const shopifyResult = await this.validateShopifyAlignment(config);
    if (!shopifyResult.valid) {
      result.valid = false;
      result.errors.push(...shopifyResult.errors);
    }
    result.warnings.push(...shopifyResult.warnings);

    // 3. Database schema alignment
    const dbResult = await this.validateDatabaseAlignment(config);
    if (!dbResult.valid) {
      result.valid = false;
      result.errors.push(...dbResult.errors);
    }
    result.warnings.push(...dbResult.warnings);

    return result;
  }

  /**
   * Validate config alignment with Shopify API requirements
   */
  async validateShopifyAlignment(config: SeedConfig): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // Validate each order
    for (let i = 0; i < config.orders.length; i++) {
      const order = config.orders[i];
      const orderPrefix = `Order ${i + 1}`;

      // Validate customer format
      if (!order.customer.email || !order.customer.email.includes("@")) {
        result.valid = false;
        result.errors.push(`${orderPrefix}: Customer email is invalid`);
      }

      // Validate line items
      if (order.lineItems.length === 0) {
        result.valid = false;
        result.errors.push(`${orderPrefix}: Must have at least one line item`);
      }

      for (let j = 0; j < order.lineItems.length; j++) {
        const item = order.lineItems[j];
        const itemPrefix = `${orderPrefix}, Line Item ${j + 1}`;

        // Validate SKU format (basic check)
        if (!item.sku || item.sku.trim().length === 0) {
          result.valid = false;
          result.errors.push(`${itemPrefix}: SKU is required`);
        }

        // Validate quantity
        if (item.quantity < 1) {
          result.valid = false;
          result.errors.push(`${itemPrefix}: Quantity must be >= 1`);
        }

        // Validate pickType
        if (item.pickType !== "Regular" && item.pickType !== "Pick and Pack") {
          result.valid = false;
          result.errors.push(`${itemPrefix}: Invalid pickType: ${item.pickType}`);
        }

        // Check if variant exists and has Shopify ID
        // This should never fail if variants are properly filtered, but validate as safety check
        try {
          const configRegion =
            config.region || config.collectionPreps?.[0]?.region || config.collectionPrep?.region || "CA";
          const variant = await this.dataRepository.getShopifyVariantId(item.sku, configRegion);
          if (!variant) {
            result.valid = false;
            result.errors.push(
              `${itemPrefix}: SKU ${item.sku} does not have a Shopify variant ID for region ${configRegion}. This variant should not have been selectable.`,
            );
          }
        } catch (error) {
          result.valid = false;
          result.errors.push(
            `${itemPrefix}: Could not verify Shopify variant ID for ${item.sku}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return result;
  }

  /**
   * Validate config alignment with database schema requirements
   */
  async validateDatabaseAlignment(config: SeedConfig): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // Collect all SKUs for batch validation
    const allSkus = new Set<string>();
    for (const order of config.orders) {
      for (const item of order.lineItems) {
        allSkus.add(item.sku);
      }
    }

    // Validate SKUs exist in database
    const configRegion = config.region || config.collectionPreps?.[0]?.region || config.collectionPrep?.region || "CA";
    for (const sku of allSkus) {
      const variant = await this.prisma.variant.findFirst({
        where: {
          sku,
          region: configRegion,
          disabled: false,
        },
      });

      if (!variant) {
        result.valid = false;
        result.errors.push(`SKU ${sku} does not exist in database for region ${configRegion}`);
      }
    }

    // Validate collection preps (new array format)
    if (config.collectionPreps && config.collectionPreps.length > 0) {
      for (let i = 0; i < config.collectionPreps.length; i++) {
        const prep = config.collectionPreps[i];
        const prepPrefix = `Collection Prep ${i + 1}`;

        // Validate location exists
        const location = await this.prisma.location.findUnique({
          where: {
            id_region: {
              id: prep.locationId,
              region: prep.region,
            },
          },
        });

        if (!location) {
          result.valid = false;
          result.errors.push(`${prepPrefix}: Location ${prep.locationId} does not exist for region ${prep.region}`);
        }

        // Validate carrier exists in enum and is available for region
        // Note: prep.carrier contains Carrier.id, which is set to carrier.code in ConfigDataRepository.getCarriers()
        // So prep.carrier should match carrier.code from the enum (case-insensitive comparison)
        const carrierCode = prep.carrier;
        const carrier = carriers.find((c) => c.code.toLowerCase() === carrierCode.toLowerCase());

        if (!carrier) {
          result.valid = false;
          result.errors.push(
            `${prepPrefix}: Carrier ${carrierCode} not found in carriers enum. This carrier should not have been selectable.`,
          );
        } else {
          // Check if carrier is available for the specified region
          // Carriers with region: null are available for all regions
          const isAvailableForRegion = carrier.region === null || carrier.region === prep.region;

          if (!isAvailableForRegion) {
            result.valid = false;
            result.errors.push(
              `${prepPrefix}: Carrier ${carrierCode} is not available for region ${prep.region}. This carrier should not have been selectable.`,
            );
          }
        }

        // Validate prepDate is valid
        try {
          const prepDate = new Date(prep.prepDate);
          if (isNaN(prepDate.getTime())) {
            result.valid = false;
            result.errors.push(`${prepPrefix}: prepDate is invalid: ${prep.prepDate}`);
          }
        } catch {
          result.valid = false;
          result.errors.push(`${prepPrefix}: prepDate parsing failed: ${prep.prepDate}`);
        }
      }
    }
    // Validate legacy single collection prep
    else if (config.collectionPrep) {
      const location = await this.prisma.location.findUnique({
        where: {
          id_region: {
            id: config.collectionPrep.locationId,
            region: config.collectionPrep.region,
          },
        },
      });

      if (!location) {
        result.valid = false;
        result.errors.push(
          `Collection prep location ${config.collectionPrep.locationId} does not exist for region ${config.collectionPrep.region}`,
        );
      }

      // Validate carrier exists in enum and is available for region
      const carrierCode = config.collectionPrep.carrier;
      const carrier = carriers.find((c) => c.code.toLowerCase() === carrierCode.toLowerCase());

      if (!carrier) {
        result.valid = false;
        result.errors.push(
          `Carrier ${carrierCode} not found in carriers enum. This carrier should not have been selectable.`,
        );
      } else {
        // Check if carrier is available for the specified region
        // Carriers with region: null are available for all regions
        const isAvailableForRegion = carrier.region === null || carrier.region === config.collectionPrep.region;

        if (!isAvailableForRegion) {
          result.valid = false;
          result.errors.push(
            `Carrier ${carrierCode} is not available for region ${config.collectionPrep.region}. This carrier should not have been selectable.`,
          );
        }
      }

      // Validate prepDate is valid
      try {
        const prepDate = new Date(config.collectionPrep.prepDate);
        if (isNaN(prepDate.getTime())) {
          result.valid = false;
          result.errors.push(`Collection prep prepDate is invalid: ${config.collectionPrep.prepDate}`);
        }
      } catch {
        result.valid = false;
        result.errors.push(`Collection prep prepDate parsing failed: ${config.collectionPrep.prepDate}`);
      }
    }

    // Validate region consistency
    const regions = new Set<string>();
    if (config.region) {
      regions.add(config.region);
    }
    if (config.collectionPreps) {
      for (const prep of config.collectionPreps) {
        regions.add(prep.region);
        if (config.region && prep.region !== config.region) {
          result.warnings.push(
            `Region mismatch: top-level region is "${config.region}" but collection prep has region "${prep.region}".`,
          );
        }
      }
    }
    if (config.collectionPrep) {
      regions.add(config.collectionPrep.region);
      if (config.region && config.collectionPrep.region !== config.region) {
        result.warnings.push(
          `Region mismatch: top-level region is "${config.region}" but collectionPrep.region is "${config.collectionPrep.region}". Using collectionPrep.region.`,
        );
      }
    }

    if (regions.size > 1) {
      result.warnings.push("Multiple regions detected in config");
    }

    // Use existing DataValidationService for additional checks
    try {
      await this.dataValidationService.validateSeedConfig(config);
    } catch (error) {
      if (error instanceof Error) {
        result.errors.push(`Data validation: ${error.message}`);
        result.valid = false;
      }
    }

    return result;
  }
}
