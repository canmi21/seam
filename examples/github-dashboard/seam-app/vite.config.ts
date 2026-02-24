/* examples/github-dashboard/seam-app/vite.config.ts */
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { watchReloadTrigger } from "@canmi/seam-server";

function seamReloadPlugin(outDir = ".seam/dev-output"): Plugin {
  return {
    name: "seam-reload",
    configureServer(server) {
      const watcher = watchReloadTrigger(resolve(outDir), () => {
        server.ws.send({ type: "full-reload" });
      });
      server.httpServer?.on("close", () => watcher.close());
    },
  };
}

export default defineConfig({
  plugins: [react(), seamReloadPlugin()],
  appType: "custom",
  server: {
    origin: "http://localhost:5173",
  },
  build: {
    manifest: true,
    rollupOptions: {
      input: "src/client/main.tsx",
    },
  },
});
