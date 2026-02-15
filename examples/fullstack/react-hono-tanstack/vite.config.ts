/* examples/fullstack/react-hono-tanstack/vite.config.ts */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    manifest: true,
  },
  server: {
    // Proxy seam routes to the backend in dev
    proxy: {
      "/_seam/subscribe": {
        target: "http://localhost:3000",
        // SSE requires no response buffering and no timeout
        timeout: 0,
        proxyTimeout: 0,
        headers: { Connection: "keep-alive" },
      },
      "/_seam": "http://localhost:3000",
    },
  },
});
