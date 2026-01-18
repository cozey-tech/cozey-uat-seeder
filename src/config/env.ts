import { z } from "zod";
import { AwsSecretsService } from "../services/AwsSecretsService";
import { Logger } from "../utils/logger";

// Schema for raw env vars (before processing)
const rawEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SHOPIFY_STORE_DOMAIN: z.string().min(1),
  SHOPIFY_ACCESS_TOKEN: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().optional().default("2024-01"),
  DATABASE_CONNECTION_LIMIT: z.string().optional(), // Optional connection pool limit (parsed as string from env)
});

// Schema for processed config (after connection limit applied)
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SHOPIFY_STORE_DOMAIN: z.string().min(1),
  SHOPIFY_ACCESS_TOKEN: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().optional().default("2024-01"),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;
let isInitialized = false;
let secretsFromAws = false;

/**
 * Get AWS configuration from environment variables
 */
function getAwsConfig(): {
  useAwsSecrets: boolean;
  region: string;
  profile?: string;
  databaseSecretName: string;
  shopifySecretName: string;
} {
  const useAwsSecrets = process.env.USE_AWS_SECRETS !== "false"; // Default to true
  const region = process.env.AWS_REGION || "us-east-1";
  const profile = process.env.AWS_PROFILE; // Optional - if not set, uses default profile
  const databaseSecretName = process.env.AWS_DATABASE_SECRET_NAME || "dev/uat-database-url";
  const shopifySecretName = process.env.AWS_SHOPIFY_SECRET_NAME || "dev/shopify-access-token";

  return {
    useAwsSecrets,
    region,
    profile,
    databaseSecretName,
    shopifySecretName,
  };
}

/**
 * Load environment variables from .env files
 */
function loadEnvVars(): Partial<z.infer<typeof rawEnvSchema>> {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION,
    DATABASE_CONNECTION_LIMIT: process.env.DATABASE_CONNECTION_LIMIT,
  };
}

/**
 * Transform AWS secrets to use environment variable names instead of secret names
 * When secrets are stored as plain strings (not JSON), AwsSecretsService uses the
 * secret name as the key (e.g., "dev/uat-database-url"), but we need env var names
 * (e.g., "DATABASE_URL") for validation.
 *
 * @param awsSecrets - Raw secrets from AWS (may have secret names as keys)
 * @param databaseSecretName - Name of the database secret
 * @param shopifySecretName - Name of the shopify secret
 * @returns Transformed secrets with env var names as keys
 */
function transformAwsSecrets(
  awsSecrets: Record<string, unknown>,
  databaseSecretName: string,
  shopifySecretName: string,
): Record<string, unknown> {
  const transformed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(awsSecrets)) {
    // If the key matches a secret name, it's a plain string secret that needs mapping
    if (key === databaseSecretName) {
      // Plain string database secret → DATABASE_URL
      transformed.DATABASE_URL = value;
    } else if (key === shopifySecretName) {
      // Plain string shopify secret → SHOPIFY_ACCESS_TOKEN
      // Note: If the shopify secret is JSON, it will already have correct keys
      // and won't match this condition, so it will be copied as-is below
      transformed.SHOPIFY_ACCESS_TOKEN = value;
    } else {
      // JSON secrets or other keys already have correct env var names, copy as-is
      transformed[key] = value;
    }
  }

  return transformed;
}

/**
 * Initialize environment configuration by loading from AWS Secrets Manager and .env files
 * This should be called once at application startup before any services are initialized
 */
export async function initializeEnvConfig(): Promise<EnvConfig> {
  if (isInitialized && cachedConfig) {
    Logger.debug("Config already initialized, using cached config");
    return cachedConfig;
  }

  const awsConfig = getAwsConfig();
  const envVars = loadEnvVars();

  let awsSecrets: Record<string, unknown> | null = null;

  // Try to fetch from AWS if enabled
  if (awsConfig.useAwsSecrets) {
    try {
      const awsService = new AwsSecretsService(awsConfig.region, awsConfig.profile);
      const secretNames = [awsConfig.databaseSecretName, awsConfig.shopifySecretName];
      const rawAwsSecrets = await awsService.fetchSecrets(secretNames);

      if (rawAwsSecrets) {
        // Transform secret names to env var names (for plain string secrets)
        awsSecrets = transformAwsSecrets(rawAwsSecrets, awsConfig.databaseSecretName, awsConfig.shopifySecretName);
        secretsFromAws = true;
        Logger.info("Loaded secrets from AWS Secrets Manager", {
          secretCount: Object.keys(awsSecrets).length,
          secrets: Object.keys(awsSecrets),
        });
      } else {
        Logger.warn("AWS secrets fetch returned null, falling back to .env files");
      }
    } catch (error) {
      Logger.warn("Failed to initialize AWS secrets, falling back to .env files", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    Logger.info("AWS secrets disabled via USE_AWS_SECRETS=false, using .env files only");
  }

  // Merge AWS secrets with .env vars (AWS secrets override .env, but .env fills in missing values)
  const merged: Partial<z.infer<typeof rawEnvSchema>> = {
    ...envVars,
    ...(awsSecrets as Partial<z.infer<typeof rawEnvSchema>>),
  };

  // Validate raw config first (before processing connection limit)
  const rawResult = rawEnvSchema.safeParse(merged);
  if (!rawResult.success) {
    const missingVars = rawResult.error.errors.map((err) => err.path.join(".")).join(", ");
    const sources = awsSecrets ? "AWS Secrets Manager and .env files" : ".env files";
    throw new Error(
      `Missing or invalid required environment variables: ${missingVars}. ` + `Please check your ${sources}.`,
    );
  }

  const rawConfig = rawResult.data;

  // Apply connection pool limit to DATABASE_URL if specified
  let processedDatabaseUrl = rawConfig.DATABASE_URL;
  try {
    let connectionLimit: number | null = null;

    if (rawConfig.DATABASE_CONNECTION_LIMIT) {
      const parsedLimit = parseInt(rawConfig.DATABASE_CONNECTION_LIMIT, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        connectionLimit = parsedLimit;
      } else {
        // Invalid value provided - log warning and fall back to default
        Logger.warn("Invalid DATABASE_CONNECTION_LIMIT value, using default", {
          providedValue: rawConfig.DATABASE_CONNECTION_LIMIT,
          defaultValue: 10,
        });
        connectionLimit = 10; // Fall back to default
      }
    } else {
      // No value provided - use default
      connectionLimit = 10;
    }

    // Apply connection limit if URL doesn't already have one
    const url = new URL(rawConfig.DATABASE_URL);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", connectionLimit.toString());
      processedDatabaseUrl = url.toString();
    }
  } catch (error) {
    Logger.warn("Failed to parse DATABASE_URL for connection limit configuration, using original URL", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Continue with original DATABASE_URL
    processedDatabaseUrl = rawConfig.DATABASE_URL;
  }

  // Build final config with processed DATABASE_URL
  const finalConfig: Partial<EnvConfig> = {
    DATABASE_URL: processedDatabaseUrl,
    SHOPIFY_STORE_DOMAIN: rawConfig.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_ACCESS_TOKEN: rawConfig.SHOPIFY_ACCESS_TOKEN,
    SHOPIFY_API_VERSION: rawConfig.SHOPIFY_API_VERSION,
  };

  // Validate the final processed config
  const result = envSchema.safeParse(finalConfig);

  if (!result.success) {
    const missingVars = result.error.errors.map((err) => err.path.join(".")).join(", ");
    const sources = awsSecrets ? "AWS Secrets Manager and .env files" : ".env files";
    throw new Error(
      `Missing or invalid required environment variables: ${missingVars}. ` + `Please check your ${sources}.`,
    );
  }

  cachedConfig = result.data;
  isInitialized = true;

  const source = awsSecrets ? "AWS Secrets Manager (with .env fallback)" : ".env files";
  Logger.info("Environment configuration initialized", { source });

  return cachedConfig;
}

/**
 * Get the cached environment configuration
 * This is a synchronous function for backward compatibility
 *
 * @throws Error if called before initializeEnvConfig()
 */
export function getEnvConfig(): EnvConfig {
  if (!isInitialized || !cachedConfig) {
    throw new Error(
      "Environment configuration not initialized. " + "Call initializeEnvConfig() before using getEnvConfig().",
    );
  }

  return cachedConfig;
}

/**
 * Check if secrets were successfully loaded from AWS Secrets Manager
 * When secrets come from AWS, we trust them and skip staging pattern validation
 *
 * @returns true if secrets were loaded from AWS, false otherwise
 */
export function areSecretsFromAws(): boolean {
  return secretsFromAws;
}
