import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

export interface Customer {
  id: string;
  name: string;
  email: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  region: string;
  locationId: string;
}

export interface Variant {
  id: string;
  sku: string;
  modelName: string;
  colorId: string;
  shopifyIds: string[];
  region: string;
  description: string;
  pickType: "Regular" | "Pick and Pack";
  configuration?: string; // Extracted from description for modular products
}

export interface Location {
  id: string;
  name: string;
  region: string;
  provinces: string[];
}

export interface Carrier {
  id: string;
  name: string;
  region: string;
}

export interface CustomersConfig {
  customers: Customer[];
}

/**
 * Repository for fetching reference data needed for config generation
 *
 * Handles:
 * - Loading customers from JSON config file
 * - Querying database for variants, locations, carriers
 * - Extracting Shopify variant IDs from variant data
 */
export class ConfigDataRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Extract configuration from variant description
   * For modular products, configuration is typically the main part of the description
   * before color/model details
   */
  private extractConfiguration(description: string, modelName: string, colorId: string): string | undefined {
    // Remove common prefixes/suffixes and extract the configuration part
    // Examples:
    // "3-Seater With Corner L - With Ottoman & 2 Lounging Chaises - Obsidian - Original"
    // -> "3-Seater With Corner L - With Ottoman & 2 Lounging Chaises"
    // "Altitude - Dove - Storage - Modules - Wall Shelf - 1 unit (S1)"
    // -> "Storage - Modules - Wall Shelf - 1 unit (S1)"
    
    let config = description;
    
    // Remove color name if present
    const colorPattern = new RegExp(`\\s*-\\s*${colorId.replace(/-/g, "\\-")}\\s*-`, "i");
    config = config.replace(colorPattern, " - ");
    
    // Remove model name if at the start
    const modelPattern = new RegExp(`^${modelName}\\s*-\\s*`, "i");
    config = config.replace(modelPattern, "");
    
    // Remove common suffixes like " - Original", " - Square", " - REFURBISHED", etc.
    config = config.replace(/\s*-\s*(Original|Square|REFURBISHED|DONATION).*$/i, "");
    
    // Remove leading/trailing dashes and whitespace
    config = config.replace(/^[\s-]+|[\s-]+$/g, "").trim();
    
    // If the result is too short or just the model/color, return undefined
    if (config.length < 10 || config.toLowerCase() === modelName.toLowerCase() || config.toLowerCase() === colorId.toLowerCase()) {
      return undefined;
    }
    
    return config;
  }

  /**
   * Get pickType for a variant by checking its parts
   * If variant has multiple parts with different pickTypes, use the most common one
   * Defaults to "Regular" if no parts found
   */
  private getVariantPickTypeFromParts(
    variantParts: Array<{ part: { pickType: string } }>,
  ): "Regular" | "Pick and Pack" {
    if (variantParts.length === 0) {
      return "Regular"; // Default
    }

    // Count pickTypes
    const pickTypeCounts = new Map<string, number>();
    for (const vp of variantParts) {
      const pickType = vp.part.pickType;
      pickTypeCounts.set(pickType, (pickTypeCounts.get(pickType) || 0) + 1);
    }

    // Return the most common pickType, defaulting to "Regular"
    let maxCount = 0;
    let mostCommonPickType = "Regular";
    for (const [pickType, count] of pickTypeCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonPickType = pickType;
      }
    }

    return mostCommonPickType as "Regular" | "Pick and Pack";
  }

  /**
   * Get all available variants for a region with pickType and configuration
   * Variants are grouped by: model > color > configuration > variant
   */
  async getAvailableVariants(region: string): Promise<Variant[]> {
    const variants = await this.prisma.variant.findMany({
      where: {
        region,
        disabled: false,
      },
      select: {
        id: true,
        sku: true,
        modelName: true,
        colorId: true,
        shopifyIds: true,
        region: true,
        description: true,
      },
      orderBy: [
        { modelName: "asc" },
        { colorId: "asc" },
        { description: "asc" },
        { sku: "asc" },
      ],
    });

    // Batch fetch all variantParts for all variants at once to avoid connection pool exhaustion
    const variantIds = variants.map((v) => v.id);
    const allVariantParts = await this.prisma.variantPart.findMany({
      where: {
        variantId: { in: variantIds },
      },
      include: {
        part: {
          select: {
            pickType: true,
          },
        },
      },
    });

    // Group variantParts by variantId
    const variantPartsByVariantId = new Map<string, typeof allVariantParts>();
    for (const vp of allVariantParts) {
      const existing = variantPartsByVariantId.get(vp.variantId) || [];
      existing.push(vp);
      variantPartsByVariantId.set(vp.variantId, existing);
    }

    // Get pickType for each variant from batched data
    const variantsWithPickType = variants.map((v) => {
      const variantParts = variantPartsByVariantId.get(v.id) || [];
      const pickType = this.getVariantPickTypeFromParts(variantParts);
      const configuration = this.extractConfiguration(v.description, v.modelName, v.colorId);
      
      return {
        id: v.id,
        sku: v.sku,
        modelName: v.modelName,
        colorId: v.colorId,
        shopifyIds: v.shopifyIds,
        region: v.region,
        description: v.description,
        pickType,
        configuration,
      };
    });

    return variantsWithPickType;
  }

  /**
   * Load customers from config/customers.json file
   * Customers are pre-created for each FC location
   */
  async getCustomers(): Promise<Customer[]> {
    try {
      const configPath = join(process.cwd(), "config", "customers.json");
      const fileContent = readFileSync(configPath, "utf-8");
      const config: CustomersConfig = JSON.parse(fileContent);

      // Validate that all customers have locationId
      for (const customer of config.customers) {
        if (!customer.locationId) {
          throw new Error(`Customer ${customer.id} is missing locationId`);
        }
      }

      return config.customers;
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(
          `Customers config file not found at config/customers.json. Please create it first.`,
        );
      }
      throw error;
    }
  }

  /**
   * Get all locations for a region
   */
  async getLocations(region: string): Promise<Location[]> {
    const locations = await this.prisma.location.findMany({
      where: {
        region,
      },
      select: {
        id: true,
        name: true,
        region: true,
        provinces: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return locations.map((l) => ({
      id: l.id,
      name: l.name,
      region: l.region,
      provinces: l.provinces,
    }));
  }

  /**
   * Get all carriers for a region
   * Falls back to hardcoded list if carriers table is empty
   */
  async getCarriers(region: string): Promise<Carrier[]> {
    const carriers = await this.prisma.carriers.findMany({
      where: {
        region,
      },
      select: {
        id: true,
        name: true,
        region: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    // If no carriers in DB, return common carriers
    if (carriers.length === 0) {
      return [
        { id: "CANPAR", name: "Canpar", region },
        { id: "FEDEX", name: "FedEx", region },
        { id: "PUROLATOR", name: "Purolator", region },
        { id: "UPS", name: "UPS", region },
      ];
    }

    return carriers.map((c) => ({
      id: c.id,
      name: c.name,
      region: c.region,
    }));
  }

  /**
   * Get location for a customer (direct mapping from customer.locationId)
   */
  async getLocationForCustomer(customer: Customer): Promise<Location | null> {
    if (!customer.locationId) {
      return null;
    }

    const location = await this.prisma.location.findUnique({
      where: {
        id_region: {
          id: customer.locationId,
          region: customer.region,
        },
      },
      select: {
        id: true,
        name: true,
        region: true,
        provinces: true,
      },
    });

    if (!location) {
      return null;
    }

    return {
      id: location.id,
      name: location.name,
      region: location.region,
      provinces: location.provinces,
    };
  }

  /**
   * Extract Shopify variant ID for a given SKU and region
   * Handles the shopify_ids array which may contain multiple IDs per region
   */
  async getShopifyVariantId(variantSku: string, region: string): Promise<string | null> {
    const variant = await this.prisma.variant.findFirst({
      where: {
        sku: variantSku,
        region,
        disabled: false,
      },
      select: {
        shopifyIds: true,
      },
    });

    if (!variant || !variant.shopifyIds || variant.shopifyIds.length === 0) {
      return null;
    }

    // For now, return the first Shopify ID
    // In the future, we may need to map by store/region more precisely
    return variant.shopifyIds[0] || null;
  }
}
