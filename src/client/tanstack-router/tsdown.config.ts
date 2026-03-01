/* src/client/tanstack-router/tsdown.config.ts */

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", "define-routes": "src/define-routes.ts" },
  format: "esm",
  fixedExtension: false,
  dts: true,
  clean: true,
  hash: false,
});
