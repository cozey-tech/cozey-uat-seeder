import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/*.config.*", // Config files
        ".prettierrc.*", // Prettier config
        "ai-docs/**", // AI-generated documentation
        "src/index.ts", // Only exports version constant
      ],
      thresholds: {
        // Start with lower thresholds - can ratchet up as coverage improves
        lines: 50,
        functions: 60,
        branches: 40,
        statements: 50,
      },
    },
  },
});
