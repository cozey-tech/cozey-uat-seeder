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
   * Get all available variants for a region, grouped by model/color
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
      },
      orderBy: [
        { modelName: "asc" },
        { colorId: "asc" },
        { sku: "asc" },
      ],
    });

    return variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      modelName: v.modelName,
      colorId: v.colorId,
      shopifyIds: v.shopifyIds,
      region: v.region,
    }));
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
