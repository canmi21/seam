/* tests/e2e/playwright.config.ts */
import { defineConfig } from "@playwright/test";
import path from "node:path";

const buildDir = path.resolve(
  __dirname,
  "../../examples/fullstack/react-hono-tanstack/.seam/output"
);

export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  retries: 0,
  reporter: "list",

  use: {
    baseURL: "http://localhost:3456",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { browserName: "chromium" } }],

  webServer: {
    command: "bun run server/index.js",
    cwd: buildDir,
    port: 3456,
    env: { PORT: "3456" },
    reuseExistingServer: !process.env.CI,
  },
});
