/**
 * Error formatting utility for standardized, actionable error messages
 * with context and recovery suggestions.
 */

import { InputValidationError } from "../services/InputParserService";
import { DataValidationError } from "../services/DataValidationService";
import { StagingGuardrailError } from "../shared/errors/StagingGuardrailError";
import { ShopifyServiceError } from "../services/ShopifyService";
import { WmsServiceError } from "../services/WmsService";
import { CollectionPrepValidationError } from "../services/CollectionPrepService";

export interface ErrorContext {
  /**
   * Step/operation where error occurred (e.g., "Step 2 (WMS seeding)")
   */
  step?: string;
  /**
   * Order index (1-based) if error is order-specific
   */
  orderIndex?: number;
  customerEmail?: string;
  sku?: string;
  [key: string]: unknown;
}

export interface FormattedError {
  message: string;
  suggestions: string[];
  context?: string;
}

/**
 * Error formatter for consistent, actionable error messages
 */
export class ErrorFormatter {
  /**
   * Format an error with context and recovery suggestions
   * @param error - The error to format
   * @param context - Additional context about where/when error occurred
   * @returns Formatted error with message, suggestions, and context
   */
  static format(error: Error, context?: ErrorContext): FormattedError {
    const baseMessage = this.getBaseMessage(error, context);
    const suggestions = this.getRecoverySuggestions(error, context);
    const contextInfo = this.formatContext(context);

    return {
      message: baseMessage,
      suggestions,
      context: contextInfo || undefined,
    };
  }

  /**
   * Format error as a single string for console output
   * @param error - The error to format
   * @param context - Additional context
   * @returns Formatted error string ready for console output
   */
  static formatAsString(error: Error, context?: ErrorContext): string {
    const formatted = this.format(error, context);
    const parts: string[] = [];

    if (formatted.context) {
      parts.push(formatted.context);
    }

    parts.push(`❌ ${formatted.message}`);

    if (formatted.suggestions.length > 0) {
      parts.push("\n💡 Suggestions:");
      for (const suggestion of formatted.suggestions) {
        parts.push(`   • ${suggestion}`);
      }
    }

    return parts.join("\n");
  }

  /**
   * Get base error message with context
   */
  private static getBaseMessage(error: Error, context?: ErrorContext): string {
    let message = error.message;

    if (context?.step) {
      message = `${context.step}: ${message}`;
    }

    if (context?.orderIndex) {
      message = `Order ${context.orderIndex}: ${message}`;
    }

    if (error instanceof InputValidationError) {
      return this.formatInputValidationError(error);
    }

    if (error instanceof DataValidationError) {
      return this.formatDataValidationError(error);
    }

    if (error instanceof StagingGuardrailError) {
      return this.formatStagingGuardrailError(error);
    }

    if (error instanceof ShopifyServiceError) {
      return this.formatShopifyServiceError(error);
    }

    if (error instanceof WmsServiceError) {
      return this.formatWmsServiceError(error);
    }

    if (error instanceof CollectionPrepValidationError) {
      return this.formatCollectionPrepValidationError(error);
    }

    return message;
  }

  /**
   * Get recovery suggestions based on error type
   */
  private static getRecoverySuggestions(error: Error, context?: ErrorContext): string[] {
    const suggestions: string[] = [];

    if (error instanceof InputValidationError) {
      suggestions.push("Check that the JSON file is valid and matches the expected schema");
      suggestions.push("Review the schema documentation in README.md");
      if (context?.sku) {
        suggestions.push(`Verify SKU "${context.sku}" exists in the database`);
      }
    }

    if (error instanceof DataValidationError) {
      suggestions.push("Verify all SKUs exist in the WMS database for the specified region");
      suggestions.push("Check customer data in config/customers.json");
      suggestions.push("Ensure line item quantities are positive numbers");
      if (context?.sku) {
        suggestions.push(`Check if SKU "${context.sku}" is available in region ${context.region || "CA"}`);
      }
    }

    if (error instanceof StagingGuardrailError) {
      suggestions.push("Verify DATABASE_URL contains staging patterns (staging, stage, test, dev, uat)");
      suggestions.push("Verify SHOPIFY_STORE_DOMAIN is a staging store or ends with .myshopify.com");
      suggestions.push("This tool can only run against staging environments");
    }

    if (error instanceof ShopifyServiceError) {
      suggestions.push("Check Shopify API credentials and permissions");
      suggestions.push("Verify the Shopify store is accessible");
      if (error.userErrors && error.userErrors.length > 0) {
        suggestions.push("Review Shopify user errors above for specific field issues");
      }
      if (context?.sku) {
        suggestions.push(`Verify SKU "${context.sku}" exists in Shopify`);
      }
    }

    if (error instanceof WmsServiceError) {
      suggestions.push("Check database connection and credentials");
      suggestions.push("Verify the database schema is up to date (run: npm run prisma:generate)");
      if (error.message.includes("already exists")) {
        suggestions.push("This may be expected if re-running - the tool is idempotent");
      }
    }

    if (error instanceof CollectionPrepValidationError) {
      suggestions.push("Review order mix - collection preps have specific order type requirements");
      suggestions.push("Check that orders match the collection prep configuration");
    }

    // Generic suggestions for unknown errors
    if (suggestions.length === 0) {
      suggestions.push("Check the error message above for details");
      suggestions.push("Review logs for additional context");
      if (process.env.NODE_ENV === "development") {
        suggestions.push("Check stack trace for debugging information");
      }
    }

    return suggestions;
  }

  /**
   * Format context information
   */
  private static formatContext(context?: ErrorContext): string | null {
    if (!context) {
      return null;
    }

    const parts: string[] = [];

    if (context.step) {
      parts.push(`Step: ${context.step}`);
    }

    if (context.orderIndex) {
      parts.push(`Order: ${context.orderIndex}`);
    }

    if (context.customerEmail) {
      parts.push(`Customer: ${context.customerEmail}`);
    }

    if (context.sku) {
      parts.push(`SKU: ${context.sku}`);
    }

    return parts.length > 0 ? parts.join(" | ") : null;
  }

  /**
   * Format InputValidationError
   */
  private static formatInputValidationError(error: InputValidationError): string {
    let message = "Configuration file validation failed";

    if (error.message.includes("file")) {
      message = "Failed to read or parse configuration file";
    } else if (error.message.includes("schema")) {
      message = "Configuration file does not match expected schema";
    }

    // Include original message details
    const details = error.message.split("\n").slice(1).join("\n");
    if (details) {
      message += `:\n${details}`;
    }

    return message;
  }

  /**
   * Format DataValidationError
   */
  private static formatDataValidationError(error: DataValidationError): string {
    let message = "Data validation failed";

    if (error.message.includes("SKU")) {
      message = "One or more SKUs are invalid or missing from the database";
    } else if (error.message.includes("customer")) {
      message = "Customer data validation failed";
    } else if (error.message.includes("quantity")) {
      message = "Line item quantity validation failed";
    }

    // Include specific validation errors
    const details = error.message.split("\n").slice(1).join("\n");
    if (details) {
      message += `:\n${details}`;
    }

    return message;
  }

  /**
   * Format StagingGuardrailError
   */
  private static formatStagingGuardrailError(error: StagingGuardrailError): string {
    return `Staging environment check failed: ${error.message}`;
  }

  /**
   * Format ShopifyServiceError
   */
  private static formatShopifyServiceError(error: ShopifyServiceError): string {
    let message = "Shopify API operation failed";

    if (error.message.includes("variant")) {
      message = "Failed to find product variants in Shopify";
    } else if (error.message.includes("order")) {
      message = "Failed to create or process Shopify order";
    } else if (error.message.includes("fulfillment")) {
      message = "Failed to fulfill Shopify order";
    }

    // Include Shopify user errors if present
    if (error.userErrors && error.userErrors.length > 0) {
      const userErrorMessages = error.userErrors.map((ue) => {
        const field = ue.field ? ` (${ue.field.join(".")})` : "";
        return `  - ${ue.message}${field}`;
      });
      message += `:\n${userErrorMessages.join("\n")}`;
    } else {
      message += `: ${error.message}`;
    }

    return message;
  }

  /**
   * Format WmsServiceError
   */
  private static formatWmsServiceError(error: WmsServiceError): string {
    let message = "WMS database operation failed";

    if (error.message.includes("already exists")) {
      message = "Record already exists in database (this may be expected if re-running)";
    } else if (error.message.includes("not found")) {
      message = "Required record not found in database";
    } else if (error.message.includes("constraint")) {
      message = "Database constraint violation";
    }

    message += `: ${error.message}`;

    return message;
  }

  /**
   * Format CollectionPrepValidationError
   */
  private static formatCollectionPrepValidationError(error: CollectionPrepValidationError): string {
    let message = "Collection prep validation failed";

    if (error.message.includes("order mix")) {
      message = "Order mix validation failed - collection preps have specific order type requirements";
    } else if (error.message.includes("regular-only")) {
      message = "Collection prep configured as regular-only but contains Pick and Pack orders";
    } else if (error.message.includes("pnp-only")) {
      message = "Collection prep configured as PnP-only but contains regular orders";
    }

    message += `: ${error.message}`;

    return message;
  }
}
