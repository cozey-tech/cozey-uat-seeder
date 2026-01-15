module.exports = {
  env: {
    es6: true,
    node: true,
    "vitest-globals/env": true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended", // Uses the recommended rules from the @typescript-eslint/eslint-plugin
    "plugin:vitest-globals/recommended", // Used for vitest tests
    "prettier", // Uses eslint-config-prettier to disable ESLint rules from @typescript-eslint/eslint-plugin that would conflict with prettier
  ],
  plugins: [
    "@typescript-eslint", // Enables eslint-plugin-@typescript-eslint
    "jest-formatting", // Enables eslint-plugin-jest-formatting
  ],
  parser: "@typescript-eslint/parser", // Specifies the ESLint parser
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: "module",
    ecmaFeatures: {
      impliedStrict: true,
    },
  },

  rules: {
    "@typescript-eslint/camelcase": "off", // Disables rule that enforces camelcase naming convention
    "@typescript-eslint/no-var-requires": "off", // Disables rule that disallows the use of require statements
    "@typescript-eslint/explicit-member-accessibility": "off", // Turns off the requirement to explicitly define accessibility modifiers on class properties and methods
    "@typescript-eslint/consistent-type-assertions": "error", // Enforces consistent usage of type assertions
    "@typescript-eslint/explicit-module-boundary-types": "off", // Requires explicit return and argument types on exported functions' and classes' public class methods
    "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }], // Enforces no unused variables while allowing specific patterns
    "@typescript-eslint/prefer-interface": "off", // TypeScript's interface over type literal is enforced - turned off as TypeScript recommends type over interface now
    "@typescript-eslint/explicit-function-return-type": "error", // Requires explicit return types on functions and class methods
    "jest-formatting/padding-around-describe-blocks": "error", // Ensures that there is padding around describe blocks in Jest tests
    "jest-formatting/padding-around-test-blocks": "error", // Ensures that there is padding around test blocks in Jest tests
    "lines-between-class-members": ["error", "always", { exceptAfterSingleLine: true }], // Enforces lines between class members, except after single-line members
  },
};