/* eslint.config.mjs -- type-checked rules only; oxlint handles the rest */

import tseslint from "typescript-eslint";
import oxlint from "eslint-plugin-oxlint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "examples/**", "packages/cli/**"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // disable type-checked rules for files outside tsconfig (tests, configs, scripts)
  // and Bun adapter (Bun globals unresolvable by standard TS project service)
  {
    files: [
      "**/__tests__/**",
      "**/tsdown.config.ts",
      "**/scripts/**",
      "eslint.config.mjs",
      "packages/server/adapter/bun/**",
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  // oxlint plugin must be last -- turns off rules oxlint already covers
  ...oxlint.configs["flat/recommended"],
);
