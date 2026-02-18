/* packages/eslint-plugin-seam/src/index.ts */

import type { ESLint, Linter } from "eslint";
import noBrowserApis from "./rules/no-browser-apis-in-skeleton.js";
import noAsync from "./rules/no-async-in-skeleton.js";
import noNondeterministic from "./rules/no-nondeterministic-in-skeleton.js";

const rules: NonNullable<ESLint.Plugin["rules"]> = {
  "no-browser-apis-in-skeleton": noBrowserApis,
  "no-async-in-skeleton": noAsync,
  "no-nondeterministic-in-skeleton": noNondeterministic,
};

const plugin: ESLint.Plugin = {
  rules,
  configs: {} as Record<string, Linter.Config[]>,
};

// Self-referencing plugin in flat configs requires defining configs after the
// plugin object exists, so the config can reference the plugin itself.
(plugin.configs as Record<string, Linter.Config[]>).recommended = [
  {
    files: ["**/*-skeleton.tsx"],
    plugins: { seam: plugin },
    rules: {
      "seam/no-browser-apis-in-skeleton": "error",
      "seam/no-async-in-skeleton": "error",
      "seam/no-nondeterministic-in-skeleton": "error",
    },
  },
];

export default plugin;
export { rules };
