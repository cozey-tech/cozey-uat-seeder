import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SHOPIFY_STORE_DOMAIN: z.string().min(1),
  SHOPIFY_ACCESS_TOKEN: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().optional().default("2024-01"),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION,
  });

  if (!result.success) {
    const missingVars = result.error.errors.map((err) => err.path.join(".")).join(", ");
    throw new Error(
      `Missing or invalid required environment variables: ${missingVars}. Please check your .env file.`,
    );
  }

  cachedConfig = result.data;
  return cachedConfig;
}
