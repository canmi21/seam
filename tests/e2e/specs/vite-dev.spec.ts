/* tests/e2e/specs/vite-dev.spec.ts */

import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";

const seamBin = path.resolve(__dirname, "../../../target/release/seam");
const appDir = path.resolve(__dirname, "../../../examples/github-dashboard/seam-app");

function tryConnect(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port: number, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // Try IPv6 first — Vite v7 on macOS binds to ::1
    if ((await tryConnect(port, "::1")) || (await tryConnect(port, "127.0.0.1"))) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for port ${port}`);
}

let devProc: ChildProcess;

test.beforeAll(async () => {
  // Force dev build by removing production route-manifest.json.
  // Without this, seam dev skips initial build and serves stale production templates.
  const manifest = path.join(appDir, ".seam/dev-output/route-manifest.json");
  if (fs.existsSync(manifest)) fs.unlinkSync(manifest);

  devProc = spawn(seamBin, ["dev"], {
    cwd: appDir,
    detached: true,
    stdio: "pipe",
  });

  await Promise.all([waitForPort(5173), waitForPort(3000)]);
});

test.afterAll(async () => {
  if (devProc?.pid) {
    try {
      process.kill(-devProc.pid, "SIGTERM");
    } catch {
      /* already exited */
    }
  }
});

test.describe("vite dev integration", () => {
  test("page serves Vite scripts, no production assets, HMR connects", async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    const response = await page.goto("/", { waitUntil: "networkidle" });
    const html = await response!.text();

    // 1. Vite HMR client script present
    expect(html).toContain("/@vite/client");

    // 2. No production asset references
    expect(html).not.toMatch(/\/_seam\/static\/assets\//);

    // 3. No independent WebSocket reload (Vite HMR handles it)
    expect(html).not.toContain("/_seam/dev/ws");

    // 4. [vite] connected appears in console (HMR handshake)
    await expect
      .poll(() => consoleMessages.some((m) => m.includes("[vite] connected")), {
        timeout: 10_000,
        message: "expected [vite] connected in console",
      })
      .toBeTruthy();
  });
});
