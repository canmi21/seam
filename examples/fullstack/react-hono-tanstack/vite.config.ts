/* examples/fullstack/react-hono-tanstack/vite.config.ts */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
