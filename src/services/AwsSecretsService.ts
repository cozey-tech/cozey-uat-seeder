import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { Logger } from "../utils/logger";

/**
 * Service for fetching secrets from AWS Secrets Manager
 *
 * Features:
 * - Fetches multiple secrets in parallel
 * - Handles errors gracefully (returns null for failed secrets)
 * - Caches secrets for the lifetime of the process
 * - Supports JSON and plain string secret formats
 */
export class AwsSecretsService {
  private readonly client: SecretsManagerClient;
  private readonly cache: Map<string, Record<string, unknown>> = new Map();

  /**
   * Initialize AWS Secrets Manager client
   *
   * @param region - AWS region (default: us-east-1)
   */
  constructor(region: string = "us-east-1") {
    // Let AWS SDK use default credential provider chain
    // This will check: env vars, IAM role, credentials file, etc.
    this.client = new SecretsManagerClient({
      region,
    });
  }

  /**
   * Fetch a single secret from AWS Secrets Manager
   *
   * @param secretName - Name of the secret to fetch
   * @returns Parsed secret data as object, or null if fetch fails
   */
  async fetchSecret(secretName: string): Promise<Record<string, unknown> | null> {
    // Check cache first
    if (this.cache.has(secretName)) {
      Logger.debug("Using cached secret", { secretName });
      return this.cache.get(secretName)!;
    }

    try {
      Logger.info("Fetching secret from AWS Secrets Manager", { secretName });

      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await this.client.send(command);

      if (!response.SecretString) {
        Logger.warn("Secret exists but has no SecretString value", { secretName });
        return null;
      }

      // Parse the secret - could be JSON or plain string
      let parsedSecret: Record<string, unknown>;
      try {
        parsedSecret = JSON.parse(response.SecretString) as Record<string, unknown>;
      } catch {
        // If not JSON, treat as plain string and use secret name as key
        Logger.debug("Secret is not JSON, treating as plain string", { secretName });
        parsedSecret = { [secretName]: response.SecretString };
      }

      // Cache the result
      this.cache.set(secretName, parsedSecret);

      Logger.info("Successfully fetched secret from AWS", { secretName });
      return parsedSecret;
    } catch (error) {
      // Log error but don't throw - allow fallback to .env
      Logger.warn("Failed to fetch secret from AWS, will fallback to .env", {
        secretName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch multiple secrets from AWS Secrets Manager in parallel
   *
   * @param secretNames - Array of secret names to fetch
   * @returns Merged object with all successfully fetched secrets, or null if all fail
   */
  async fetchSecrets(secretNames: string[]): Promise<Record<string, unknown> | null> {
    if (secretNames.length === 0) {
      return null;
    }

    Logger.info("Fetching multiple secrets from AWS Secrets Manager", {
      secretCount: secretNames.length,
      secretNames,
    });

    // Fetch all secrets in parallel
    const results = await Promise.allSettled(
      secretNames.map((secretName) => this.fetchSecret(secretName)),
    );

    // Merge successful results
    const merged: Record<string, unknown> = {};
    let hasAnySuccess = false;

    results.forEach((result, index) => {
      const secretName = secretNames[index];
      if (result.status === "fulfilled" && result.value !== null) {
        Object.assign(merged, result.value);
        hasAnySuccess = true;
        Logger.info("Successfully merged secret", { secretName });
      } else {
        Logger.warn("Secret fetch failed or returned null", {
          secretName,
          reason: result.status === "rejected" ? result.reason?.message : "returned null",
        });
      }
    });

    if (!hasAnySuccess) {
      Logger.warn("All secrets failed to fetch from AWS", { secretNames });
      return null;
    }

    Logger.info("Successfully fetched secrets from AWS", {
      successCount: Object.keys(merged).length,
      secretNames,
    });

    return merged;
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}
