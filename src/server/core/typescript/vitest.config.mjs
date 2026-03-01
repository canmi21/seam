/* src/server/core/typescript/vitest.config.mjs */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve to native source so tests run without building WASM package
      "@canmi/seam-injector": resolve(__dirname, "../../../server/injector/native/src/index.ts"),
    },
  },
});
