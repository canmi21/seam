/* src/cli/pkg/tsdown.config.ts */

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  fixedExtension: false,
  clean: true,
  hash: false,
});
