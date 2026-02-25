/* tests/e2e/playwright.config.ts */
import { defineConfig } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";

const fixtureDir = path.resolve(__dirname, "fixture/.seam/output");
const fullstackDir = path.resolve(
  __dirname,
  "../../examples/github-dashboard/seam-app/.seam/output",
);
const workspaceRoot = path.resolve(__dirname, "../..");
const workspaceExampleDir = path.resolve(workspaceRoot, "examples/github-dashboard");

// Load .env from workspace root (GITHUB_TOKEN raises API rate limit from 60 to 5000/hour)
try {
  const envFile = readFileSync(path.join(workspaceRoot, ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // .env is optional
}

const ghToken = process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {};

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
      testIgnore: /fullstack|vite-dev|workspace|nextjs/,
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
    {
      name: "nextjs",
      use: { browserName: "chromium", baseURL: "http://localhost:3463" },
      testMatch: /nextjs/,
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
      env: { PORT: "3457", ...ghToken },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bun run backends/ts-hono/src/index.ts",
      cwd: workspaceExampleDir,
      port: 3460,
      env: { PORT: "3460", SEAM_OUTPUT_DIR: "seam-app/.seam/output", ...ghToken },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: path.join(workspaceRoot, "target/release/github-dashboard-axum"),
      port: 3461,
      env: {
        PORT: "3461",
        SEAM_OUTPUT_DIR: path.join(workspaceExampleDir, "seam-app/.seam/output"),
        ...ghToken,
      },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: path.join(workspaceExampleDir, "backends/go-gin/server"),
      port: 3462,
      env: {
        PORT: "3462",
        SEAM_OUTPUT_DIR: path.join(workspaceExampleDir, "seam-app/.seam/output"),
        ...ghToken,
      },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bunx next dev --port 3463",
      cwd: path.join(workspaceExampleDir, "next-app"),
      port: 3463,
      env: { ...ghToken },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
