import { getEnvConfig, areSecretsFromAws } from "./env";
import { StagingGuardrailError } from "../shared/errors/StagingGuardrailError";

// Staging DB URL patterns - must contain one of these
const STAGING_DB_PATTERNS = [
  /staging/i,
  /stage/i,
  /test/i,
  /dev/i,
  /uat/i,
  // Add specific staging domains if needed
];

// Staging Shopify domain patterns
const STAGING_SHOPIFY_PATTERNS = [
  /staging/i,
  /stage/i,
  /test/i,
  /dev/i,
  /uat/i,
  /\.myshopify\.com$/i, // Allow any myshopify.com subdomain for staging
];

export function assertStagingEnvironment(): void {
  // Trust AWS Secrets Manager: secrets are environment-specific and managed by infrastructure
  // Pattern validation is only needed for local .env files where users might misconfigure
  if (areSecretsFromAws()) {
    return;
  }

  const config = getEnvConfig();

  // Check DB URL
  const isStagingDb = STAGING_DB_PATTERNS.some((pattern) => pattern.test(config.DATABASE_URL));
  if (!isStagingDb) {
    throw new StagingGuardrailError(
      `Database URL does not match staging patterns. Detected: ${maskUrl(config.DATABASE_URL)}`,
    );
  }

  // Check Shopify domain
  const isStagingShopify = STAGING_SHOPIFY_PATTERNS.some((pattern) => pattern.test(config.SHOPIFY_STORE_DOMAIN));
  if (!isStagingShopify) {
    throw new StagingGuardrailError(
      `Shopify domain does not match staging patterns. Detected: ${config.SHOPIFY_STORE_DOMAIN}`,
    );
  }
}

export function displayStagingEnvironment(): {
  databaseUrl: string;
  shopifyDomain: string;
  isStaging: boolean;
} {
  const config = getEnvConfig();

  // If secrets came from AWS, consider it staging (trusted source)
  if (areSecretsFromAws()) {
    return {
      databaseUrl: maskUrl(config.DATABASE_URL),
      shopifyDomain: config.SHOPIFY_STORE_DOMAIN,
      isStaging: true,
    };
  }

  const isStagingDb = STAGING_DB_PATTERNS.some((pattern) => pattern.test(config.DATABASE_URL));
  const isStagingShopify = STAGING_SHOPIFY_PATTERNS.some((pattern) => pattern.test(config.SHOPIFY_STORE_DOMAIN));

  return {
    databaseUrl: maskUrl(config.DATABASE_URL),
    shopifyDomain: config.SHOPIFY_STORE_DOMAIN,
    isStaging: isStagingDb && isStagingShopify,
  };
}

export async function requireExplicitStagingConfirmation(skipConfirmation: boolean = false): Promise<void> {
  if (skipConfirmation) {
    return;
  }

  // If secrets came from AWS, we trust them and skip validation
  if (areSecretsFromAws()) {
    return;
  }

  const env = displayStagingEnvironment();

  if (!env.isStaging) {
    throw new StagingGuardrailError(
      "Environment does not appear to be staging. Use --i-know-this-is-staging to override (not recommended).",
    );
  }

  // Note: Actual confirmation prompt will be handled in orchestrator with inquirer
  // This function just validates the environment is staging
}

function maskUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Mask password if present
    if (urlObj.password) {
      urlObj.password = "***";
    }
    return urlObj.toString();
  } catch {
    // If URL parsing fails, just mask the middle part
    if (url.length > 50) {
      return `${url.substring(0, 20)}...${url.substring(url.length - 20)}`;
    }
    return url.replace(/:[^:@]+@/, ":***@");
  }
}
