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
  promptService?: { promptConfirm: (message: string, defaultAnswer?: boolean) => Promise<boolean> },
): Promise<{ data: ReferenceData; loadTime: number }> {
  const referenceDataStart = Date.now();
  const loadingProgress = new ProgressTracker({ showSpinner: true });
  loadingProgress.start("Loading reference data", 4);

  // Add timeout wrapper for database queries (60 seconds)
  // Query can take 45-50 seconds for large datasets (50k+ variants)
  const QUERY_TIMEOUT_MS = 60000;
  const withTimeout = <T>(promise: Promise<T>, operation: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => {
          reject(
            new Error(
              `Database query timeout: ${operation} exceeded ${QUERY_TIMEOUT_MS}ms. Check database connection and query performance.`,
            ),
          );
        }, QUERY_TIMEOUT_MS),
      ),
    ]);
  };

  loadingProgress.update(1, "Loading variants...");
  let variants: Variant[] = [];
  let variantsLoadFailed = false;

  // Check if we're already in templates-only mode (from connection test graceful degradation)
  const isTemplatesOnlyMode = (globalThis as { __TEMPLATES_ONLY_MODE__?: boolean }).__TEMPLATES_ONLY_MODE__ === true;

  if (isTemplatesOnlyMode) {
    // Skip database queries - we're already in templates-only mode
    variantsLoadFailed = true;
    loadingProgress.update(1, "Skipped variants (using templates only)...");
    console.log(OutputFormatter.info("Skipping database queries (templates-only mode)..."));
  } else {
    try {
      variants = await withTimeout(dataRepository.getAvailableVariants(region), "getAvailableVariants");
    } catch (error) {
      variantsLoadFailed = true;

      // Offer graceful degradation: continue with templates only
      if (promptService) {
        loadingProgress.fail("Failed to load variants");
        console.error();
        console.error(OutputFormatter.warning("Database query failed while loading variants."));
        if (error instanceof Error) {
          if (error.message.includes("timeout")) {
            console.error(OutputFormatter.listItem("Query timed out - database may be slow or unavailable."));
          } else if (error.message.includes("P1001") || error.message.includes("connection")) {
            console.error(OutputFormatter.listItem("Cannot connect to database."));
          } else {
            console.error(OutputFormatter.listItem(`Error: ${error.message}`));
          }
        }
        console.error();
        const continueWithTemplates = await promptService.promptConfirm(
          "Would you like to continue using only order templates (without database variants)?",
          false,
        );
        if (!continueWithTemplates) {
          throw new Error("Config generation cancelled. Please fix database connection and try again.");
        }
        console.log(OutputFormatter.info("Continuing with templates only mode..."));
        // Restart progress tracker since we're continuing
        loadingProgress.start("Loading reference data", 4);
        loadingProgress.update(1, "Skipped variants (using templates only)...");
      } else {
        // If no promptService, fail and throw the error
        loadingProgress.fail("Failed to load variants");
        throw error;
      }
    }
  }

  loadingProgress.update(2, "Loading customers...");
  // Skip database queries if in templates-only mode
  const customers = isTemplatesOnlyMode ? [] : await dataRepository.getCustomers(region);

  loadingProgress.update(3, "Loading carriers...");
  // Skip database queries if in templates-only mode
  const carriers = isTemplatesOnlyMode ? [] : await dataRepository.getCarriers(region);

  loadingProgress.update(4, "Loading templates...");
  const allTemplates = loadOrderTemplates();

  const referenceDataLoadTime = Date.now() - referenceDataStart;
  loadingProgress.complete(`✓ Loaded reference data`);

  // Filter templates to only include those with valid SKUs for this region
  // If variants failed to load, skip validation and use all templates
  const templates = variantsLoadFailed ? allTemplates : filterValidTemplates(allTemplates, variants);

  // Batch fetch all locations for customers upfront (performance optimization)
  const locationLoadStart = Date.now();
  const locationProgress = new ProgressTracker({ showSpinner: true });
  locationProgress.start("Loading customer locations", customers.length);

  let locationsCache: Map<string, Location>;
  try {
    locationsCache = await Promise.race([
      dataRepository.getLocationsForCustomers(customers),
      new Promise<Map<string, Location>>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Database query timeout: getLocationsForCustomers exceeded ${QUERY_TIMEOUT_MS}ms`)),
          QUERY_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (error) {
    locationProgress.fail("Failed to load customer locations");
    if (error instanceof Error && error.message.includes("timeout")) {
      throw new Error(
        `Database query timed out while loading customer locations. Check database connection and performance.\n\n` +
          `Original error: ${error.message}`,
      );
    }
    throw error;
  }
  const locationLoadTime = Date.now() - locationLoadStart;

  locationProgress.complete(`✓ Loaded ${locationsCache.size} location(s)`);

  const referenceItems: Array<{ label: string; value: string | number }> = [
    { label: "Variants", value: variants.length },
    { label: "Customers", value: customers.length },
    { label: "Carriers", value: carriers.length },
    {
      label: "Templates",
      value: `${templates.length} valid${templates.length !== allTemplates.length ? ` (${allTemplates.length - templates.length} filtered out)` : ""}`,
    },
    { label: "Locations", value: locationsCache.size },
  ];

  console.log(
    OutputFormatter.summary({
      title: OutputFormatter.header("Reference Data Loaded", "📊"),
      items: referenceItems,
    }),
  );
  console.log();

  // Validate reference data is not empty
  // If variants failed to load, we're in templates-only mode, so skip variant validation
  if (variants.length === 0 && !variantsLoadFailed) {
    throw new Error(`No variants found for region ${region}. Please check database.`);
  }
  if (variantsLoadFailed && templates.length === 0) {
    throw new Error("No order templates available. Cannot generate config without variants or templates.");
  }
  if (customers.length === 0) {
    throw new Error("No customers found in config/customers.json. Please add at least one customer.");
  }
  if (carriers.length === 0) {
    console.warn(OutputFormatter.warning(`No carriers found for region ${region}. Collection prep will be skipped.`));
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
