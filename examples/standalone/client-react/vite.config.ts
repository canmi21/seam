/* examples/standalone/client-react/vite.config.ts */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: process.env.SEAM_DIST_DIR ?? ".seam/dist",
    manifest: true,
    rollupOptions: {
      input: "src/main.tsx",
    },
  },
});
