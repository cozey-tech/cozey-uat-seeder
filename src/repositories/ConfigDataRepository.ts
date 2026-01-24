import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

// Postal code format validation patterns
const CA_POSTAL_CODE_REGEX = /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i; // A1A 1A1 or A1A1A1
const US_ZIP_CODE_REGEX = /^\d{5}(-\d{4})?$/; // 12345 or 12345-6789

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
    if (
      config.length < 10 ||
      config.toLowerCase() === modelName.toLowerCase() ||
      config.toLowerCase() === colorId.toLowerCase()
    ) {
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
   * Note: shopifyIds are not required - ShopifyService queries Shopify API directly by SKU
   */
  async getAvailableVariants(region: string): Promise<Variant[]> {
    // Query without orderBy first (much faster - avoids expensive sort on unindexed columns)
    // We'll sort in memory instead
    const variants = await this.prisma.variant.findMany({
      where: {
        region,
        disabled: false,
        // Removed shopifyIds filter: ShopifyService queries Shopify API directly by SKU,
        // so variants with empty shopifyIds in WMS can still be used for order creation
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
      // Removed orderBy - sort in memory instead to avoid full table scan + sort
      // orderBy: [{ modelName: "asc" }, { colorId: "asc" }, { description: "asc" }, { sku: "asc" }],
    });

    // Sort in memory (much faster than database sort on unindexed columns)
    variants.sort((a, b) => {
      if (a.modelName !== b.modelName) return a.modelName.localeCompare(b.modelName);
      if (a.colorId !== b.colorId) return a.colorId.localeCompare(b.colorId);
      if (a.description !== b.description) return a.description.localeCompare(b.description);
      return a.sku.localeCompare(b.sku);
    });

    // Batch fetch all variantParts for all variants in chunks to avoid large IN clause performance issues
    // PostgreSQL has limits on IN clause size, and large IN clauses can be very slow
    const variantIds = variants.map((v) => v.id);

    // Process in chunks of 1000 to avoid large IN clause performance degradation
    const BATCH_SIZE = 1000;
    const allVariantParts: Array<{
      variantId: string;
      partId: string;
      quantity: number;
      part: { pickType: string };
    }> = [];

    for (let i = 0; i < variantIds.length; i += BATCH_SIZE) {
      const batch = variantIds.slice(i, i + BATCH_SIZE);
      const batchParts = await this.prisma.variantPart.findMany({
        where: {
          variantId: { in: batch },
        },
        include: {
          part: {
            select: {
              pickType: true,
            },
          },
        },
      });
      // Convert Decimal quantity to number
      allVariantParts.push(
        ...batchParts.map((vp) => ({
          variantId: vp.variantId,
          partId: vp.partId,
          quantity: vp.quantity.toNumber(),
          part: vp.part,
        })),
      );
    }

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
   * @param region Optional region filter. If provided, only returns customers matching that region.
   */
  async getCustomers(region?: string): Promise<Customer[]> {
    try {
      const configPath = join(process.cwd(), "config", "customers.json");
      const fileContent = readFileSync(configPath, "utf-8");
      const config: CustomersConfig = JSON.parse(fileContent);

      // Validate that all customers have required fields
      for (const customer of config.customers) {
        if (!customer.locationId) {
          throw new Error(`Customer ${customer.id} is missing locationId`);
        }

        // Validate address fields (required for order creation)
        const missingFields: string[] = [];
        if (!customer.address) missingFields.push("address");
        if (!customer.city) missingFields.push("city");
        if (!customer.province) missingFields.push("province");
        if (!customer.postalCode) missingFields.push("postalCode");

        if (missingFields.length > 0) {
          throw new Error(`Customer ${customer.id} is missing required address fields: ${missingFields.join(", ")}`);
        }

        // Validate postal code format
        const isValidPostalCode =
          customer.region === "CA"
            ? CA_POSTAL_CODE_REGEX.test(customer.postalCode!)
            : US_ZIP_CODE_REGEX.test(customer.postalCode!);

        if (!isValidPostalCode) {
          const expectedFormat = customer.region === "CA" ? "A1A 1A1 or A1A1A1" : "12345 or 12345-6789";
          throw new Error(
            `Customer ${customer.id} has invalid postal code format: "${customer.postalCode}". Expected format for ${customer.region}: ${expectedFormat}`,
          );
        }
      }

      // Filter by region if provided
      let customers = config.customers;
      if (region) {
        customers = config.customers.filter((customer) => customer.region === region);
      }

      return customers;
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(`Customers config file not found at config/customers.json. Please create it first.`);
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
   * Carriers are defined as code constants (enum) rather than database records.
   * Returns carriers that match the specified region or have region: null (available for all regions)
   */
  async getCarriers(region: string): Promise<Carrier[]> {
    // Import carriers from the enum definition
    const { carriers: carrierDefinitions } = await import("../shared/carriers");

    // Filter carriers by region:
    // - Include carriers with region === null (available for all regions)
    // - Include carriers with region matching the requested region
    const matchingCarriers = carrierDefinitions.filter(
      (carrier) => carrier.region === null || carrier.region === region,
    );

    // Map to the Carrier interface format (id, name, region)
    // Use code as id, and set region to the requested region (or the carrier's specific region if not null)
    const result: Carrier[] = matchingCarriers.map((carrier) => ({
      id: carrier.code,
      name: carrier.name,
      region: carrier.region || region, // Use carrier's region if specified, otherwise use requested region
    }));

    // Sort by name for consistency
    result.sort((a, b) => a.name.localeCompare(b.name));

    return result;
  }

  /**
   * Get locations for multiple customers in a single batched query
   * Returns a Map keyed by customer ID for O(1) lookup
   */
  async getLocationsForCustomers(customers: Customer[]): Promise<Map<string, Location>> {
    if (customers.length === 0) {
      return new Map();
    }

    // Group customers by region to batch queries efficiently
    const customersByRegion = new Map<string, Customer[]>();
    for (const customer of customers) {
      if (!customer.locationId) {
        continue; // Skip customers without locationId
      }
      const regionCustomers = customersByRegion.get(customer.region) || [];
      regionCustomers.push(customer);
      customersByRegion.set(customer.region, regionCustomers);
    }

    const locationMap = new Map<string, Location>();

    // Batch fetch locations for each region
    for (const [region, regionCustomers] of customersByRegion.entries()) {
      // Get unique location IDs for this region
      const locationIds = Array.from(new Set(regionCustomers.map((c) => c.locationId).filter(Boolean)));

      if (locationIds.length === 0) {
        continue;
      }

      // Single batched query for all locations in this region
      const locations = await this.prisma.location.findMany({
        where: {
          region,
          id: { in: locationIds },
        },
        select: {
          id: true,
          name: true,
          region: true,
          provinces: true,
        },
      });

      // Map locations by ID
      const locationsById = new Map(locations.map((l) => [l.id, l]));

      // Map to customers by locationId
      for (const customer of regionCustomers) {
        if (customer.locationId) {
          const location = locationsById.get(customer.locationId);
          if (location) {
            locationMap.set(customer.id, {
              id: location.id,
              name: location.name,
              region: location.region,
              provinces: location.provinces,
            });
          }
        }
      }
    }

    return locationMap;
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
