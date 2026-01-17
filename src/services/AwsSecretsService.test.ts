import { describe, expect, it, beforeEach, vi } from "vitest";
import { AwsSecretsService } from "./AwsSecretsService";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// Mock AWS SDK
vi.mock("@aws-sdk/client-secrets-manager", () => {
  return {
    SecretsManagerClient: vi.fn(),
    GetSecretValueCommand: vi.fn(),
  };
});

// Mock credential providers
vi.mock("@aws-sdk/credential-providers", () => {
  return {
    fromIni: vi.fn(() => ({})),
  };
});

describe("AwsSecretsService", () => {
  let mockSend: ReturnType<typeof vi.fn>;
  let service: AwsSecretsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    (SecretsManagerClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      send: mockSend,
    }));
    service = new AwsSecretsService("us-east-1", undefined);
    service.clearCache();
  });

  describe("fetchSecret", () => {
    it("should fetch and parse JSON secret successfully", async () => {
      const secretData = {
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      };
      mockSend.mockResolvedValueOnce({
        SecretString: JSON.stringify(secretData),
      });

      const result = await service.fetchSecret("dev/uat-database-url");

      expect(result).toEqual(secretData);
      expect(GetSecretValueCommand).toHaveBeenCalledWith({
        SecretId: "dev/uat-database-url",
      });
    });

    it("should handle plain string secret (non-JSON)", async () => {
      const plainString = "my-secret-value";
      mockSend.mockResolvedValueOnce({
        SecretString: plainString,
      });

      const result = await service.fetchSecret("dev/simple-secret");

      expect(result).toEqual({ "dev/simple-secret": plainString });
    });

    it("should cache secret after first fetch", async () => {
      const secretData = { key: "value" };
      mockSend.mockResolvedValueOnce({
        SecretString: JSON.stringify(secretData),
      });

      const result1 = await service.fetchSecret("dev/test-secret");
      const result2 = await service.fetchSecret("dev/test-secret");

      expect(result1).toEqual(secretData);
      expect(result2).toEqual(secretData);
      // Should only call AWS SDK once due to caching
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should return null when secret has no SecretString", async () => {
      mockSend.mockResolvedValueOnce({
        SecretString: undefined,
      });

      const result = await service.fetchSecret("dev/empty-secret");

      expect(result).toBeNull();
    });

    it("should return null and log warning on AWS error", async () => {
      const error = new Error("Secret not found");
      mockSend.mockRejectedValueOnce(error);

      const result = await service.fetchSecret("dev/nonexistent-secret");

      expect(result).toBeNull();
    });

    it("should handle network timeout gracefully", async () => {
      const timeoutError = new Error("Network timeout");
      timeoutError.name = "TimeoutError";
      mockSend.mockRejectedValueOnce(timeoutError);

      const result = await service.fetchSecret("dev/timeout-secret");

      expect(result).toBeNull();
    });
  });

  describe("fetchSecrets", () => {
    it("should fetch multiple secrets in parallel", async () => {
      const secret1 = { DATABASE_URL: "postgresql://localhost/db" };
      const secret2 = {
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_STORE_DOMAIN: "store.myshopify.com",
      };

      mockSend
        .mockResolvedValueOnce({
          SecretString: JSON.stringify(secret1),
        })
        .mockResolvedValueOnce({
          SecretString: JSON.stringify(secret2),
        });

      const result = await service.fetchSecrets([
        "dev/uat-database-url",
        "dev/shopify-access-token",
      ]);

      expect(result).toEqual({
        ...secret1,
        ...secret2,
      });
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should return partial results when one secret fails", async () => {
      const secret1 = { DATABASE_URL: "postgresql://localhost/db" };
      mockSend
        .mockResolvedValueOnce({
          SecretString: JSON.stringify(secret1),
        })
        .mockRejectedValueOnce(new Error("Secret not found"));

      const result = await service.fetchSecrets([
        "dev/uat-database-url",
        "dev/nonexistent-secret",
      ]);

      expect(result).toEqual(secret1);
    });

    it("should return null when all secrets fail", async () => {
      mockSend
        .mockRejectedValueOnce(new Error("Secret 1 not found"))
        .mockRejectedValueOnce(new Error("Secret 2 not found"));

      const result = await service.fetchSecrets([
        "dev/nonexistent-1",
        "dev/nonexistent-2",
      ]);

      expect(result).toBeNull();
    });

    it("should return null for empty secret array", async () => {
      const result = await service.fetchSecrets([]);

      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should merge secrets correctly when keys overlap", async () => {
      const secret1 = { KEY1: "value1", KEY2: "value2" };
      const secret2 = { KEY2: "value2-override", KEY3: "value3" };

      mockSend
        .mockResolvedValueOnce({
          SecretString: JSON.stringify(secret1),
        })
        .mockResolvedValueOnce({
          SecretString: JSON.stringify(secret2),
        });

      const result = await service.fetchSecrets(["dev/secret1", "dev/secret2"]);

      // Later secrets override earlier ones
      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2-override",
        KEY3: "value3",
      });
    });
  });

  describe("clearCache", () => {
    it("should clear cached secrets", async () => {
      const secretData = { key: "value" };
      mockSend.mockResolvedValue({
        SecretString: JSON.stringify(secretData),
      });

      await service.fetchSecret("dev/test-secret");
      expect(mockSend).toHaveBeenCalledTimes(1);

      service.clearCache();

      await service.fetchSecret("dev/test-secret");
      // Should call AWS SDK again after cache clear
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("profile support", () => {
    it("should accept profile parameter in constructor", () => {
      const serviceWithProfile = new AwsSecretsService("us-east-1", "dev");
      expect(serviceWithProfile).toBeInstanceOf(AwsSecretsService);
    });
  });

  describe("credential error handling", () => {
    it("should handle expired credentials error", async () => {
      const expiredError = new Error("The security token included in the request is expired");
      expiredError.name = "CredentialsProviderError";
      mockSend.mockRejectedValueOnce(expiredError);

      const result = await service.fetchSecret("dev/test-secret");

      expect(result).toBeNull();
    });

    it("should handle invalid credentials error", async () => {
      const invalidError = new Error("InvalidClientTokenId");
      invalidError.name = "InvalidClientTokenId";
      mockSend.mockRejectedValueOnce(invalidError);

      const result = await service.fetchSecret("dev/test-secret");

      expect(result).toBeNull();
    });
  });
});
