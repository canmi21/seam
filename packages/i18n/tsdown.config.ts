/* packages/i18n/tsdown.config.ts */

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", react: "src/react.ts" },
  format: "esm",
  fixedExtension: false,
  dts: true,
  clean: true,
  hash: false,
});
