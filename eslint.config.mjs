import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import vitestPlugin from "@vitest/eslint-plugin";
import prettierConfig from "eslint-config-prettier";
import jestFormatting from "eslint-plugin-jest-formatting";
import globals from "globals";

export default [
  // Base JavaScript config
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  // TypeScript config
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        impliedStrict: true,
        project: "./tsconfig.json",
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/camelcase": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/explicit-member-accessibility": "off",
      "@typescript-eslint/consistent-type-assertions": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
      "@typescript-eslint/prefer-interface": "off",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
      "lines-between-class-members": ["error", "always", { exceptAfterSingleLine: true }],
    },
  },
  // Vitest config - extends TypeScript config
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    plugins: {
      "@typescript-eslint": tseslint,
      vitest: vitestPlugin,
      "jest-formatting": jestFormatting,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        impliedStrict: true,
        project: "./tsconfig.json",
      },
      globals: {
        ...globals.node,
        ...vitestPlugin.environments.env.globals,
      },
    },
    rules: {
      // Include TypeScript rules from the main config
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/camelcase": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/explicit-member-accessibility": "off",
      "@typescript-eslint/consistent-type-assertions": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
      "@typescript-eslint/prefer-interface": "off",
      // Allow implicit return types in tests for readability
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
      "lines-between-class-members": ["error", "always", { exceptAfterSingleLine: true }],
      // Vitest-specific rules
      ...vitestPlugin.configs.recommended.rules,
      "jest-formatting/padding-around-describe-blocks": "error",
      "jest-formatting/padding-around-test-blocks": "error",
    },
  },
  // Prettier config (must be last to override other rules)
  prettierConfig,
  // Ignore patterns
  {
    ignores: ["node_modules/**", "dist/**", "build/**", "coverage/**", "*.tsbuildinfo", ".prisma/**"],
  },
];
