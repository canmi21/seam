/* tests/e2e/playwright.config.ts */
import { defineConfig } from "@playwright/test";
import path from "node:path";

const fixtureDir = path.resolve(__dirname, "fixture/.seam/output");
const fullstackDir = path.resolve(
  __dirname,
  "../../examples/github-dashboard/seam-app/.seam/output",
);
const workspaceRoot = path.resolve(__dirname, "../..");
const workspaceExampleDir = path.resolve(workspaceRoot, "examples/github-dashboard");

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
      testIgnore: /fullstack|vite-dev|workspace/,
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
    {
      name: "workspace-ts-hono",
      use: { browserName: "chromium", baseURL: "http://localhost:3460" },
      testMatch: /workspace/,
    },
    {
      name: "workspace-rust-axum",
      use: { browserName: "chromium", baseURL: "http://localhost:3461" },
      testMatch: /workspace/,
    },
    {
      name: "workspace-go-gin",
      use: { browserName: "chromium", baseURL: "http://localhost:3462" },
      testMatch: /workspace/,
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
    {
      command: "bun run backends/ts-hono/src/index.ts",
      cwd: workspaceExampleDir,
      port: 3460,
      env: { PORT: "3460", SEAM_OUTPUT_DIR: "seam-app/.seam/output" },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: path.join(workspaceRoot, "target/release/github-dashboard-axum"),
      port: 3461,
      env: {
        PORT: "3461",
        SEAM_OUTPUT_DIR: path.join(workspaceExampleDir, "seam-app/.seam/output"),
      },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: path.join(workspaceExampleDir, "backends/go-gin/server"),
      port: 3462,
      env: {
        PORT: "3462",
        SEAM_OUTPUT_DIR: path.join(workspaceExampleDir, "seam-app/.seam/output"),
      },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
