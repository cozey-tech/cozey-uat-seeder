import { z } from "zod";
import { AwsSecretsService } from "../services/AwsSecretsService";
import { Logger } from "../utils/logger";

// Schema for raw env vars (before processing)
const rawEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  // CA Shopify (required for backward compatibility)
  SHOPIFY_STORE_DOMAIN: z.string().min(1),
  SHOPIFY_ACCESS_TOKEN: z.string().min(1),
  // US Shopify (optional - only needed for US region)
  SHOPIFY_STORE_DOMAIN_US: z.string().min(1).optional(),
  SHOPIFY_ACCESS_TOKEN_US: z.string().min(1).optional(),
  SHOPIFY_API_VERSION: z.string().optional().default("2024-01"),
  DATABASE_CONNECTION_LIMIT: z.string().optional(), // Optional connection pool limit (parsed as string from env)
});

// Schema for processed config (after connection limit applied)
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SHOPIFY_STORE_DOMAIN: z.string().min(1),
  SHOPIFY_ACCESS_TOKEN: z.string().min(1),
  SHOPIFY_STORE_DOMAIN_US: z.string().min(1).optional(),
  SHOPIFY_ACCESS_TOKEN_US: z.string().min(1).optional(),
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
    SHOPIFY_STORE_DOMAIN_US: process.env.SHOPIFY_STORE_DOMAIN_US,
    SHOPIFY_ACCESS_TOKEN_US: process.env.SHOPIFY_ACCESS_TOKEN_US,
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

  // Check if we have individual database components that need to be assembled
  const hasDbComponents =
    (awsSecrets.username || awsSecrets.user) &&
    (awsSecrets.password || awsSecrets.pass) &&
    (awsSecrets.host || awsSecrets.hostname) &&
    (awsSecrets.dbname || awsSecrets.database || awsSecrets.db);

  // If we have individual components but no DATABASE_URL, assemble it
  if (hasDbComponents && !awsSecrets.DATABASE_URL) {
    const username = (awsSecrets.username || awsSecrets.user) as string;
    const password = (awsSecrets.password || awsSecrets.pass) as string;
    const host = (awsSecrets.host || awsSecrets.hostname) as string;
    const port = (awsSecrets.port || "5432") as string;
    const dbname = (awsSecrets.dbname || awsSecrets.database || awsSecrets.db) as string;
    const engine = (awsSecrets.engine || "postgresql") as string;

    // Construct DATABASE_URL from components
    const protocol = engine === "postgres" || engine === "postgresql" ? "postgresql" : engine;
    // Omit port if it's the default PostgreSQL port (5432) to match Neon's expected format
    const portSegment = port === "5432" ? "" : `:${port}`;
    let baseUrl = `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}${portSegment}/${dbname}`;

    // Add SSL parameters if provided in AWS secrets, or default for Neon/hosted databases
    const searchParams = new URLSearchParams();
    if (awsSecrets.sslmode) {
      searchParams.set("sslmode", awsSecrets.sslmode as string);
    } else if (host.includes("neon.tech") || host.includes("aws.neon")) {
      // Neon databases require SSL
      searchParams.set("sslmode", "require");
    }
    if (awsSecrets.channel_binding) {
      searchParams.set("channel_binding", awsSecrets.channel_binding as string);
    } else if (host.includes("neon.tech") || host.includes("aws.neon")) {
      // Neon databases often require channel_binding
      searchParams.set("channel_binding", "require");
    }
    // Only add connect_timeout if explicitly provided in AWS secrets
    // Don't add it by default as it may cause connection issues
    if (awsSecrets.connect_timeout) {
      searchParams.set("connect_timeout", awsSecrets.connect_timeout as string);
    }

    if (searchParams.toString()) {
      baseUrl += `?${searchParams.toString()}`;
    }

    transformed.DATABASE_URL = baseUrl;

    Logger.info("Assembled DATABASE_URL from individual AWS secret components", {
      host,
      port,
      dbname,
      username: username.substring(0, 3) + "***", // Log masked username
      hasSslParams: searchParams.toString().length > 0,
    });
  }

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
    } else if (
      key !== "username" &&
      key !== "user" &&
      key !== "password" &&
      key !== "pass" &&
      key !== "host" &&
      key !== "hostname" &&
      key !== "port" &&
      key !== "dbname" &&
      key !== "database" &&
      key !== "db" &&
      key !== "engine"
    ) {
      // JSON secrets or other keys already have correct env var names, copy as-is
      // Skip individual DB components if we already assembled DATABASE_URL
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
  // NOTE: For Neon databases, we skip adding connection_limit to match their expected URL format
  let processedDatabaseUrl = rawConfig.DATABASE_URL;
  const isNeonDatabase = processedDatabaseUrl.includes("neon.tech") || processedDatabaseUrl.includes("aws.neon");

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
    // Skip for Neon databases to match their expected URL format
    if (!isNeonDatabase) {
      const url = new URL(rawConfig.DATABASE_URL);
      if (!url.searchParams.has("connection_limit")) {
        url.searchParams.set("connection_limit", connectionLimit.toString());
        processedDatabaseUrl = url.toString();
      }
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
    SHOPIFY_STORE_DOMAIN_US: rawConfig.SHOPIFY_STORE_DOMAIN_US,
    SHOPIFY_ACCESS_TOKEN_US: rawConfig.SHOPIFY_ACCESS_TOKEN_US,
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

  // CRITICAL: Update process.env with processed DATABASE_URL so PrismaClient can use it
  // PrismaClient reads DATABASE_URL from process.env, not from our config object
  process.env.DATABASE_URL = result.data.DATABASE_URL;

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

/**
 * Get Shopify configuration for a specific region
 * @param region - Region code ("CA" or "US")
 * @returns Shopify configuration for the specified region
 * @throws Error if configuration is missing for the requested region
 */
export function getShopifyConfig(region: "CA" | "US"): {
  storeDomain: string;
  accessToken: string;
  apiVersion: string;
} {
  const config = getEnvConfig();

  if (region === "US") {
    if (!config.SHOPIFY_STORE_DOMAIN_US || !config.SHOPIFY_ACCESS_TOKEN_US) {
      throw new Error(
        "US Shopify configuration is missing. " +
          "Please set SHOPIFY_STORE_DOMAIN_US and SHOPIFY_ACCESS_TOKEN_US environment variables.",
      );
    }
    return {
      storeDomain: config.SHOPIFY_STORE_DOMAIN_US,
      accessToken: config.SHOPIFY_ACCESS_TOKEN_US,
      apiVersion: config.SHOPIFY_API_VERSION || "2024-01",
    };
  }

  // Default to CA
  return {
    storeDomain: config.SHOPIFY_STORE_DOMAIN,
    accessToken: config.SHOPIFY_ACCESS_TOKEN,
    apiVersion: config.SHOPIFY_API_VERSION || "2024-01",
  };
}
