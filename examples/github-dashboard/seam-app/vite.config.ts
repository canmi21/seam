/* examples/github-dashboard/seam-app/vite.config.ts */
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { watchReloadTrigger } from "@canmi/seam-server";

const obfuscate = process.env.SEAM_OBFUSCATE === "1";
const typeHint = process.env.SEAM_TYPE_HINT !== "0";
const hashLength = Number(process.env.SEAM_HASH_LENGTH) || 12;

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
    sourcemap: process.env.SEAM_SOURCEMAP === "1",
    rollupOptions: {
      input: "src/client/main.tsx",
      ...(obfuscate
        ? {
            output: {
              hashCharacters: "hex",
              ...(typeHint
                ? {
                    entryFileNames: `script-[hash:${hashLength}].js`,
                    chunkFileNames: `chunk-[hash:${hashLength}].js`,
                    assetFileNames: (info: { names?: string[] }) =>
                      info.names?.[0]?.endsWith(".css")
                        ? `style-[hash:${hashLength}].css`
                        : `[hash:${hashLength}].[ext]`,
                  }
                : {
                    entryFileNames: `[hash:${hashLength}].js`,
                    chunkFileNames: `[hash:${hashLength}].js`,
                    assetFileNames: `[hash:${hashLength}].[ext]`,
                  }),
            },
          }
        : {}),
    },
  },
});
