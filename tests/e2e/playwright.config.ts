/* tests/e2e/playwright.config.ts */
import { defineConfig } from "@playwright/test";
import path from "node:path";

const fixtureDir = path.resolve(__dirname, "fixture/.seam/output");
const fullstackDir = path.resolve(
  __dirname,
  "../../examples/github-dashboard/seam-app/.seam/output",
);

export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  retries: 0,
  reporter: "list",

  use: {
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", baseURL: "http://localhost:3456" },
      testIgnore: /fullstack|vite-dev/,
    },
    {
      name: "fullstack",
      use: { browserName: "chromium", baseURL: "http://localhost:3457" },
      testMatch: /fullstack/,
    },
    {
      name: "vite-dev",
      use: { browserName: "chromium", baseURL: "http://localhost:3000" },
      testMatch: /vite-dev/,
      dependencies: ["fullstack"],
      timeout: 60_000,
    },
  ],

  webServer: [
    {
      command: "bun run server/index.js",
      cwd: fixtureDir,
      port: 3456,
      env: { PORT: "3456" },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bun run server/index.js",
      cwd: fullstackDir,
      port: 3457,
      env: { PORT: "3457" },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
