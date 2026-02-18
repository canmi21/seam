/* eslint.config.mjs */

/* eslint.config.mjs -- type-checked rules only; oxlint handles the rest */

import tseslint from "typescript-eslint";
import oxlint from "eslint-plugin-oxlint";
import seamPlugin from "./packages/eslint-plugin-seam/src/index.ts";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/target/**",
      "**/.seam/**",
      "examples/**",
      "packages/cli/**",
    ],
  },
  {
    plugins: { seam: seamPlugin },
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
      "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 100, skipBlankLines: true, skipComments: true }],
    },
  },
  // disable type-checked rules for files outside tsconfig (tests, configs, scripts)
  // and Bun adapter (Bun globals unresolvable by standard TS project service)
  {
    files: [
      "**/__tests__/**",
      "tests/**",
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
