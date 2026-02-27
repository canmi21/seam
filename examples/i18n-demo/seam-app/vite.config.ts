/* examples/i18n-demo/seam-app/vite.config.ts */
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function seamRpcPlugin(): Plugin {
  const mapPath = process.env.SEAM_RPC_MAP_PATH;
  if (!mapPath) return { name: "seam-rpc-noop" };
  let procedures: Record<string, string> = {};
  return {
    name: "seam-rpc-transform",
    buildStart() {
      try {
        const map = JSON.parse(readFileSync(mapPath, "utf-8"));
        procedures = { ...map.procedures, _batch: map.batch };
      } catch {
        /* obfuscation off or file missing */
      }
    },
    transform(code, id) {
      if (!Object.keys(procedures).length) return;
      if (id.includes("node_modules") && !id.includes("@canmi/seam-")) return;
      let result = code;
      for (const [name, hash] of Object.entries(procedures)) {
        result = result.replaceAll(`"${name}"`, `"${hash}"`);
      }
      return result !== code ? result : undefined;
    },
  };
}

export default defineConfig({
  plugins: [react(), seamRpcPlugin()],
  appType: "custom",
  build: {
    manifest: true,
    rollupOptions: {
      input: "src/client/main.tsx",
    },
  },
});
