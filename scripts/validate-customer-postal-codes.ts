#!/usr/bin/env tsx
/**
 * Validates that all customer postal codes match at least one carrier's
 * postal code routing rules.
 *
 * Usage: npm run tsx scripts/validate-customer-postal-codes.ts
 */

import { readFileSync } from "fs";
import { join } from "path";

interface Customer {
  id: string;
  name: string;
  email: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  region: string;
  locationId: string;
}

interface CustomersConfig {
  customers: Customer[];
}

interface Carrier {
  code: string;
  name: string;
  region: string | null;
  postalCodes?: string[];
}

interface CarriersConfig {
  carriers: Carrier[];
}

interface ValidationResult {
  customer: Customer;
  postalCodePrefix: string;
  matchingCarriers: string[];
  isValid: boolean;
}

/**
 * Extract postal code prefix for carrier matching
 * - CA: First 3 characters (e.g., "V6C" from "V6C 1S4")
 * - US: First 5 characters (e.g., "90001" from "90001")
 */
function extractPostalCodePrefix(postalCode: string, region: string): string {
  const cleaned = postalCode.replace(/\s+/g, "").toUpperCase();

  if (region === "CA") {
    // Canadian postal code: first 3 characters (FSA - Forward Sortation Area)
    return cleaned.substring(0, 3);
  } else {
    // US ZIP code: first 5 digits
    return cleaned.substring(0, 5);
  }
}

/**
 * Check if postal code prefix matches any carrier's routing rules
 */
function validatePostalCode(customer: Customer, carriers: Carrier[]): ValidationResult {
  const postalCodePrefix = extractPostalCodePrefix(customer.postalCode, customer.region);

  // Find carriers that serve this region or serve all regions (null)
  const applicableCarriers = carriers.filter(
    (carrier) => carrier.region === null || carrier.region === customer.region,
  );

  // Find carriers that can serve this postal code
  const matchingCarriers = applicableCarriers
    .filter((carrier) => {
      // Carriers without postal code lists can serve ANY location (national carriers like FedEx, Nationex)
      if (!carrier.postalCodes || carrier.postalCodes.length === 0) {
        return true;
      }
      // Carriers with postal code lists must have this specific prefix
      return carrier.postalCodes.includes(postalCodePrefix);
    })
    .map((carrier) => carrier.name);

  return {
    customer,
    postalCodePrefix,
    matchingCarriers,
    isValid: matchingCarriers.length > 0,
  };
}

/**
 * Main validation function
 */
function main(): void {
  console.log("📍 Validating customer postal codes against carrier routing rules...\n");

  // Load customers
  const customersPath = join(process.cwd(), "config", "customers.json");
  const customersConfig: CustomersConfig = JSON.parse(readFileSync(customersPath, "utf-8"));

  // Load carriers
  const carriersPath = join(process.cwd(), "config", "carriers.json");
  const carriersConfig: CarriersConfig = JSON.parse(readFileSync(carriersPath, "utf-8"));

  // Validate each customer
  const results: ValidationResult[] = [];
  for (const customer of customersConfig.customers) {
    const result = validatePostalCode(customer, carriersConfig.carriers);
    results.push(result);
  }

  // Report results
  const invalidResults = results.filter((r) => !r.isValid);
  const validResults = results.filter((r) => r.isValid);

  console.log(`✅ Valid: ${validResults.length}/${results.length} customers`);
  console.log(`❌ Invalid: ${invalidResults.length}/${results.length} customers\n`);

  if (validResults.length > 0) {
    console.log("Valid Customers:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    for (const result of validResults) {
      console.log(
        `  ✓ ${result.customer.id.padEnd(30)} | ${result.postalCodePrefix} | ${result.matchingCarriers.join(", ")}`,
      );
    }
    console.log();
  }

  if (invalidResults.length > 0) {
    console.log("❌ INVALID Customers (no matching carriers):");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    for (const result of invalidResults) {
      console.log(
        `  ✗ ${result.customer.id.padEnd(30)} | ${result.postalCodePrefix} | Postal: ${result.customer.postalCode}`,
      );
      console.log(`    Location: ${result.customer.city}, ${result.customer.province}`);
      console.log(`    Issue: No carrier serves postal code prefix "${result.postalCodePrefix}"`);
      console.log();
    }
    console.log("⚠️  WARNING: These customers' postal codes don't match any carrier routing rules.");
    console.log("   This may cause carrier assignment failures during order fulfillment.\n");
    process.exit(1);
  }

  console.log("🎉 All customer postal codes are compatible with carrier routing rules!");
  process.exit(0);
}

// Run validation
main();
