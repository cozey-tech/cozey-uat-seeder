import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { fromIni } from "@aws-sdk/credential-providers";
import { Logger } from "../utils/logger";

/**
 * Service for fetching secrets from AWS Secrets Manager
 *
 * Features:
 * - Fetches multiple secrets in parallel
 * - Handles errors gracefully (returns null for failed secrets)
 * - Caches secrets for the lifetime of the process
 * - Supports JSON and plain string secret formats
 * - Supports AWS profile selection from ~/.aws/credentials
 * - Handles expired credentials with clear error messages
 */
export class AwsSecretsService {
  private readonly client: SecretsManagerClient;
  private readonly cache: Map<string, Record<string, unknown>> = new Map();

  /**
   * Initialize AWS Secrets Manager client
   *
   * @param region - AWS region (default: us-east-1)
   * @param profile - AWS profile name from ~/.aws/credentials (optional)
   */
  constructor(region: string = "us-east-1", profile?: string) {
    const clientConfig: {
      region: string;
      credentials?: ReturnType<typeof fromIni>;
    } = {
      region,
    };

    // If profile is specified, use fromIni provider for that profile
    // Otherwise, let AWS SDK use default credential provider chain
    if (profile) {
      Logger.info("Using AWS profile for credentials", { profile, region });
      clientConfig.credentials = fromIni({ profile });
    } else {
      Logger.debug("Using default AWS credential provider chain", { region });
    }

    this.client = new SecretsManagerClient(clientConfig);
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
      // Handle specific AWS credential errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : "";

      // Check for credential-related errors
      if (
        errorName === "CredentialsProviderError" ||
        errorMessage.includes("credentials") ||
        errorMessage.includes("expired") ||
        errorMessage.includes("InvalidClientTokenId") ||
        errorMessage.includes("SignatureDoesNotMatch")
      ) {
        Logger.error(
          "AWS credentials error - check your credentials or profile configuration",
          error,
          {
            secretName,
            hint: "Verify AWS credentials are valid and not expired. " +
              "If using profiles, ensure AWS_PROFILE is set correctly.",
          },
        );
      } else {
        // Other errors (network, permissions, etc.)
        Logger.warn("Failed to fetch secret from AWS, will fallback to .env", {
          secretName,
          error: errorMessage,
          errorName,
        });
      }

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
