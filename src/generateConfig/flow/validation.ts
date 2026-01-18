/**
 * Incremental validation for config generator
 *
 * Validates orders and collection prep configuration as they're created,
 * providing immediate feedback to users.
 */

import type { OrderComposition } from "../../services/OrderCompositionBuilder";
import type { Variant } from "../../repositories/ConfigDataRepository";
import { OutputFormatter } from "../../utils/outputFormatter";

export interface ValidationIssue {
  type: "error" | "warning";
  message: string;
  orderIndex?: number;
}

export interface OrderValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Validate a single order composition
 */
export function validateOrder(
  orderIndex: number,
  composition: OrderComposition,
  variants: Variant[],
  customerEmail?: string,
): OrderValidationResult {
  const issues: ValidationIssue[] = [];
  const variantMap = new Map(variants.map((v) => [v.sku, v]));

  // Check for required fields
  if (composition.lineItems.length === 0) {
    issues.push({
      type: "error",
      message: "Order must have at least one line item",
      orderIndex,
    });
  }

  // Validate each line item
  for (let i = 0; i < composition.lineItems.length; i++) {
    const item = composition.lineItems[i];
    const itemPrefix = `Line item ${i + 1}`;

    // Check SKU exists in variants
    if (!variantMap.has(item.sku)) {
      issues.push({
        type: "error",
        message: `${itemPrefix}: SKU "${item.sku}" not found in available variants`,
        orderIndex,
      });
    }

    // Check quantity
    if (item.quantity < 1) {
      issues.push({
        type: "error",
        message: `${itemPrefix}: Quantity must be >= 1`,
        orderIndex,
      });
    }

    // Check pickType matches variant
    const variant = variantMap.get(item.sku);
    if (variant && item.pickType !== variant.pickType) {
      issues.push({
        type: "warning",
        message: `${itemPrefix}: PickType "${item.pickType}" doesn't match variant's pickType "${variant.pickType}". Variant's pickType will be used.`,
        orderIndex,
      });
    }
  }

  // Validate customer email format
  if (customerEmail && !customerEmail.includes("@")) {
    issues.push({
      type: "error",
      message: "Customer email is invalid",
      orderIndex,
    });
  }

  return {
    valid: issues.filter((i) => i.type === "error").length === 0,
    issues,
  };
}

/**
 * Validate collection prep configuration
 */
export function validateCollectionPrep(
  prepIndex: number,
  orderIndices: number[],
  orders: Array<{ composition: OrderComposition }>,
  hasPnpConfig: boolean,
): OrderValidationResult {
  const issues: ValidationIssue[] = [];

  // Check if orders have PnP items
  const hasPnpItems = orderIndices.some((idx) => {
    const order = orders[idx];
    return order.composition.lineItems.some((item) => item.pickType === "Pick and Pack");
  });

  // Warn if PnP config provided but no PnP items
  if (hasPnpConfig && !hasPnpItems) {
    issues.push({
      type: "warning",
      message: `Collection Prep ${prepIndex + 1}: PnP config provided but orders have no Pick and Pack items`,
      orderIndex: prepIndex,
    });
  }

  // Warn if PnP items exist but no PnP config
  if (hasPnpItems && !hasPnpConfig) {
    issues.push({
      type: "warning",
      message: `Collection Prep ${prepIndex + 1}: Orders have Pick and Pack items but no PnP config provided`,
      orderIndex: prepIndex,
    });
  }

  return {
    valid: true, // Warnings don't make it invalid
    issues,
  };
}

/**
 * Display validation issues to user
 */
export function displayValidationIssues(issues: ValidationIssue[]): void {
  if (issues.length === 0) {
    return;
  }

  const errors = issues.filter((i) => i.type === "error");
  const warnings = issues.filter((i) => i.type === "warning");

  if (errors.length > 0) {
    console.log();
    console.log(OutputFormatter.error("Validation Errors:"));
    errors.forEach((issue) => {
      const prefix = issue.orderIndex !== undefined ? `Order ${issue.orderIndex + 1}: ` : "";
      console.log(OutputFormatter.listItem(`${prefix}${issue.message}`));
    });
    console.log();
  }

  if (warnings.length > 0) {
    console.log();
    console.log(OutputFormatter.warning("Validation Warnings:"));
    warnings.forEach((issue) => {
      const prefix = issue.orderIndex !== undefined ? `Order ${issue.orderIndex + 1}: ` : "";
      console.log(OutputFormatter.listItem(`${prefix}${issue.message}`));
    });
    console.log();
  }
}

/**
 * Get validation summary for review step
 */
export function getValidationSummary(
  orders: Array<{ composition: OrderComposition }>,
  variants: Variant[],
): { errorCount: number; warningCount: number; issues: ValidationIssue[] } {
  const allIssues: ValidationIssue[] = [];

  // Validate each order
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const validation = validateOrder(i, order.composition, variants);
    allIssues.push(...validation.issues);
  }

  const errorCount = allIssues.filter((i) => i.type === "error").length;
  const warningCount = allIssues.filter((i) => i.type === "warning").length;

  return {
    errorCount,
    warningCount,
    issues: allIssues,
  };
}
