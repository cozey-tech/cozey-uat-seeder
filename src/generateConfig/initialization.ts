/**
 * Initialization logic for config generator
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { OrderTemplate } from "../services/InteractivePromptService";
import type { Variant, Customer, Carrier, Location } from "../repositories/ConfigDataRepository";
import { ConfigDataRepository } from "../repositories/ConfigDataRepository";
import { OutputFormatter } from "../utils/outputFormatter";
import { ProgressTracker } from "../utils/progress";

export interface ReferenceData {
  variants: Variant[];
  customers: Customer[];
  carriers: Carrier[];
  templates: OrderTemplate[];
  locationsCache: Map<string, Location>;
}

/**
 * Load order templates from config file
 */
export function loadOrderTemplates(): OrderTemplate[] {
  try {
    const configPath = join(process.cwd(), "config", "orderTemplates.json");
    const fileContent = readFileSync(configPath, "utf-8");
    const config = JSON.parse(fileContent);
    return config.templates || [];
  } catch {
    console.warn(OutputFormatter.warning("Could not load order templates, continuing without them"));
    return [];
  }
}

/**
 * Save a new template to the order templates file
 * Creates the file structure if it doesn't exist
 */
export function saveTemplate(template: OrderTemplate): void {
  try {
    const configPath = join(process.cwd(), "config", "orderTemplates.json");
    
    // Read existing config or create new structure
    let config: { templates: OrderTemplate[] };
    try {
      const fileContent = readFileSync(configPath, "utf-8");
      config = JSON.parse(fileContent);
      // Ensure templates array exists
      if (!config.templates || !Array.isArray(config.templates)) {
        config.templates = [];
      }
    } catch {
      // File doesn't exist or is invalid - create new structure
      config = { templates: [] };
    }
    
    // Check if template with same ID already exists
    const existingIndex = config.templates.findIndex((t: OrderTemplate) => t.id === template.id);
    if (existingIndex !== -1) {
      // Update existing template
      config.templates[existingIndex] = template;
      console.log(OutputFormatter.success(`Updated existing template: ${template.name} (${template.id})`));
    } else {
      // Add new template
      config.templates.push(template);
      console.log(OutputFormatter.success(`Saved new template: ${template.name} (${template.id})`));
    }
    
    // Write back to file
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    throw new Error(`Failed to save template: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Filter templates to only include those with valid SKUs for the given variants
 * Note: pickType in templates is informational only - the variant's pickType from the database will always be used
 */
export function filterValidTemplates(
  templates: OrderTemplate[],
  variants: Array<{ sku: string; pickType: "Regular" | "Pick and Pack" }>,
): OrderTemplate[] {
  // Create a set of valid SKUs for quick lookup
  const validSkus = new Set(variants.map((v) => v.sku));
  
  const validTemplates: OrderTemplate[] = [];
  const invalidTemplates: Array<{ template: OrderTemplate; reasons: string[] }> = [];

  for (const template of templates) {
    const reasons: string[] = [];
    
    // Check each line item in the template
    for (const item of template.lineItems) {
      if (!validSkus.has(item.sku)) {
        reasons.push(`SKU "${item.sku}" not found in database for this region`);
      }
    }

    if (reasons.length === 0) {
      validTemplates.push(template);
    } else {
      invalidTemplates.push({ template, reasons });
    }
  }

  // Report invalid templates with detailed error messages
  if (invalidTemplates.length > 0) {
    console.warn();
    console.warn(OutputFormatter.warning(`Filtered out ${invalidTemplates.length} invalid template(s):`));
    for (const { template, reasons } of invalidTemplates) {
      console.warn(OutputFormatter.listItem(`Template "${template.name}" (${template.id}):`));
      for (const reason of reasons) {
        console.warn(OutputFormatter.listItem(reason, 2));
      }
    }
    console.warn();
  }

  return validTemplates;
}

/**
 * Load all reference data with progress tracking
 */
export async function loadReferenceData(
  dataRepository: ConfigDataRepository,
  region: "CA" | "US",
): Promise<{ data: ReferenceData; loadTime: number }> {
  const referenceDataStart = Date.now();
  const loadingProgress = new ProgressTracker({ showSpinner: false });
  loadingProgress.start("Loading reference data", 4);
  
  console.log(OutputFormatter.info("Loading reference data..."));
  
  loadingProgress.update(1, "Loading variants...");
  const variantsPromise = dataRepository.getAvailableVariants(region);
  
  loadingProgress.update(2, "Loading customers...");
  const customersPromise = dataRepository.getCustomers(region);
  
  loadingProgress.update(3, "Loading carriers...");
  const carriersPromise = dataRepository.getCarriers(region);
  
  loadingProgress.update(4, "Loading templates...");
  const templatesPromise = Promise.resolve(loadOrderTemplates());
  
  let [variants, customers, carriers, allTemplates] = await Promise.all([
    variantsPromise,
    customersPromise,
    carriersPromise,
    templatesPromise,
  ]);
  
  const referenceDataLoadTime = Date.now() - referenceDataStart;
  loadingProgress.complete(`Loaded reference data (${OutputFormatter.duration(referenceDataLoadTime)})`);

  // Filter templates to only include those with valid SKUs for this region
  console.log(OutputFormatter.info("Validating templates..."));
  let templates = filterValidTemplates(allTemplates, variants);

  // Batch fetch all locations for customers upfront (performance optimization)
  const locationLoadStart = Date.now();
  const locationProgress = new ProgressTracker({ showSpinner: false });
  locationProgress.start("Loading locations", customers.length);
  
  console.log(OutputFormatter.info("Loading customer locations..."));
  const locationsCache = await dataRepository.getLocationsForCustomers(customers);
  const locationLoadTime = Date.now() - locationLoadStart;
  
  locationProgress.update(customers.length);
  locationProgress.complete(`Loaded ${locationsCache.size} location(s) (${OutputFormatter.duration(locationLoadTime)})`);
  console.log();

  const referenceItems: Array<{ label: string; value: string | number }> = [
    { label: "Variants", value: variants.length },
    { label: "Customers", value: customers.length },
    { label: "Carriers", value: carriers.length },
    { label: "Templates", value: `${templates.length} valid${templates.length !== allTemplates.length ? ` (${allTemplates.length - templates.length} filtered out)` : ""}` },
    { label: "Locations", value: locationsCache.size },
  ];
  
  console.log(OutputFormatter.summary({
    title: OutputFormatter.header("Reference Data Loaded", "📊"),
    items: referenceItems,
  }));
  console.log();

  // Validate reference data is not empty
  if (variants.length === 0) {
    throw new Error(`No variants found for region ${region}. Please check database.`);
  }
  if (customers.length === 0) {
    throw new Error(
      "No customers found in config/customers.json. Please add at least one customer.",
    );
  }
  if (carriers.length === 0) {
    console.warn(
      OutputFormatter.warning(`No carriers found for region ${region}. Collection prep will be skipped.`),
    );
    console.warn(
      OutputFormatter.info(`To enable collection prep, add carriers to the database for region ${region}.\n`),
    );
  }

  return {
    data: {
      variants,
      customers,
      carriers,
      templates,
      locationsCache,
    },
    loadTime: referenceDataLoadTime + locationLoadTime,
  };
}
