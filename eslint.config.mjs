/* eslint.config.mjs */

/* eslint.config.mjs -- type-checked rules only; oxlint handles the rest */

import tseslint from "typescript-eslint";
import oxlint from "eslint-plugin-oxlint";
import seamPlugin from "./packages/eslint-plugin-seam/src/index.ts";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/target/**", "**/.seam/**", "packages/cli/**"],
  },
  {
    plugins: { seam: seamPlugin },
  },
  // type-checked rules: skip examples entirely (no tsconfig project)
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    ignores: [...(c.ignores ?? []), "examples/**"],
  })),
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    ignores: ["examples/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 100, skipBlankLines: true, skipComments: true }],
    },
  },
  // skeleton files in examples need TS parser (type-checked configs skip examples/)
  {
    files: ["examples/**/*-skeleton.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  // skeleton-specific seam rules (covers examples/ and tests/)
  {
    files: ["**/*-skeleton.tsx"],
    rules: {
      "seam/no-async-in-skeleton": "error",
      "seam/no-effect-in-skeleton": "warn",
      "seam/no-nondeterministic-in-skeleton": "error",
      "seam/no-browser-apis-in-skeleton": "error",
    },
  },
  // disable type-checked rules for files outside tsconfig
  {
    files: [
      "**/__tests__/**",
      "tests/**",
      "**/tsdown.config.ts",
      "**/scripts/**",
      "eslint.config.mjs",
      "packages/server/adapter/bun/**",
      "examples/**",
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  // oxlint plugin must be last -- turns off rules oxlint already covers
  ...oxlint.configs["flat/recommended"],
);
