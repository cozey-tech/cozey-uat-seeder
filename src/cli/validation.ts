/**
 * Validation functions for CLI
 */

import { InputParserService, InputValidationError } from "../services/InputParserService";
import { DataValidationService, DataValidationError } from "../services/DataValidationService";
import { assertStagingEnvironment, displayStagingEnvironment } from "../config/stagingGuardrails";
import { StagingGuardrailError } from "../shared/errors/StagingGuardrailError";
import type { SeedConfig } from "../shared/types/SeedConfig";
import { ErrorFormatter } from "../utils/errorFormatter";
import { OutputFormatter } from "../utils/outputFormatter";

/**
 * Validate configuration file against schema
 */
export async function validateConfig(configFilePath: string): Promise<void> {
  const inputParser = new InputParserService();

  try {
    const config = inputParser.parseInputFile(configFilePath);

    // Note: pnpConfig is optional - boxes already exist in the database
    // If pnpConfig is provided, validate it, but don't require it for PnP items
    if (config.pnpConfig) {
      if (!config.pnpConfig.packageInfo || config.pnpConfig.packageInfo.length === 0) {
        throw new InputValidationError("pnpConfig provided but no packageInfo defined");
      }
      if (!config.pnpConfig.boxes || config.pnpConfig.boxes.length === 0) {
        throw new InputValidationError("pnpConfig provided but no boxes defined");
      }
    }

    // Display validation results
    const validationItems: Array<{ label: string; value: string | number }> = [
      { label: "Schema", value: "Valid" },
      { label: "Orders", value: config.orders.length },
      { label: "Collection Prep", value: config.collectionPrep ? "Configured" : "Not configured" },
    ];
    if (config.pnpConfig) {
      validationItems.push({ label: "PnP Config", value: "Present" });
    }

    console.log(
      OutputFormatter.summary({
        title: OutputFormatter.success("Configuration file validation passed"),
        items: validationItems,
      }),
    );
  } catch (error) {
    if (error instanceof InputValidationError) {
      const formattedError = ErrorFormatter.formatAsString(error, { step: "Config validation" });
      console.error(`\n${formattedError}\n`);
      process.exit(1);
    }
    // Handle file I/O errors, permission errors, etc.
    const formattedError = ErrorFormatter.formatAsString(error instanceof Error ? error : new Error(String(error)), {
      step: "Config file reading",
    });
    console.error(`\n${formattedError}\n`);
    process.exit(1);
  }
}

/**
 * Parse and validate configuration file
 */
export function parseAndValidateConfig(configFilePath: string, inputParser: InputParserService): SeedConfig {
  console.log(OutputFormatter.info(`Parsing configuration file: ${configFilePath}`));
  try {
    return inputParser.parseInputFile(configFilePath);
  } catch (error) {
    if (error instanceof InputValidationError) {
      const formattedError = ErrorFormatter.formatAsString(error, { step: "Config parsing" });
      console.error(`\n${formattedError}\n`);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Validate data (SKUs, customers, etc.)
 */
export async function validateData(config: SeedConfig, dataValidator: DataValidationService): Promise<void> {
  console.log(OutputFormatter.info("Validating data..."));
  try {
    await dataValidator.validateSeedConfig(config);
  } catch (error) {
    if (error instanceof DataValidationError) {
      const formattedError = ErrorFormatter.formatAsString(error, { step: "Data validation" });
      console.error(`\n${formattedError}\n`);
      process.exit(1);
    }
    throw error;
  }
  console.log(OutputFormatter.success("Data validation passed\n"));
}

/**
 * Check and display staging environment
 */
export function checkStagingEnvironment(): void {
  const envInfo = displayStagingEnvironment();
  const statusEmoji = envInfo.isStaging ? "✅" : "❌";
  const statusText = envInfo.isStaging ? "Staging" : "Not Staging";

  console.log(
    OutputFormatter.summary({
      title: OutputFormatter.header("Staging Environment Check", "🔒"),
      items: [
        { label: "Database", value: envInfo.databaseUrl },
        { label: "Shopify", value: envInfo.shopifyDomain },
        { label: "Status", value: `${statusEmoji} ${statusText}` },
      ],
    }),
  );
  console.log();

  try {
    assertStagingEnvironment();
  } catch (error) {
    if (error instanceof StagingGuardrailError) {
      const formattedError = ErrorFormatter.formatAsString(error, { step: "Staging environment check" });
      console.error(`\n${formattedError}\n`);
      process.exit(1);
    }
    throw error;
  }
}
