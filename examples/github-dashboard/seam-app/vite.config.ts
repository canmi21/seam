/* examples/github-dashboard/seam-app/vite.config.ts */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  appType: "custom",
  server: {
    origin: "http://localhost:5173",
  },
});
