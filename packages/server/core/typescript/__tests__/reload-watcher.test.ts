/* packages/server/core/typescript/__tests__/reload-watcher.test.ts */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { watchReloadTrigger } from "../src/dev/reload-watcher.js";

let distDir: string;

beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), "seam-reload-test-"));
});

afterAll(() => {
  rmSync(distDir, { recursive: true, force: true });
});

describe("watchReloadTrigger", () => {
  it("calls onReload when trigger file is written", async () => {
    // Pre-create the trigger file so watch() attaches directly
    const triggerPath = join(distDir, ".reload-trigger");
    writeFileSync(triggerPath, "0");

    const reloads: number[] = [];
    const watcher = watchReloadTrigger(distDir, () => reloads.push(Date.now()));

    try {
      // Let the watcher fully settle before mutating
      await new Promise((r) => setTimeout(r, 100));

      // Mutate the file to fire the watcher
      writeFileSync(triggerPath, String(Date.now()));

      // fs.watch is async; give it time to fire
      await new Promise((r) => setTimeout(r, 300));

      expect(reloads.length).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.close();
    }
  });

  it("close() stops watching cleanly", async () => {
    const triggerPath = join(distDir, ".reload-trigger");
    writeFileSync(triggerPath, "0");

    const reloads: number[] = [];
    const watcher = watchReloadTrigger(distDir, () => reloads.push(Date.now()));
    watcher.close();

    // Write after close — should not fire
    writeFileSync(triggerPath, "2");
    await new Promise((r) => setTimeout(r, 200));

    expect(reloads.length).toBe(0);
  });

  it("watches directory when trigger file does not exist initially", async () => {
    const freshDir = mkdtempSync(join(tmpdir(), "seam-reload-nofile-"));
    const triggerPath = join(freshDir, ".reload-trigger");

    const reloads: number[] = [];
    const watcher = watchReloadTrigger(freshDir, () => reloads.push(Date.now()));

    try {
      // Create the trigger file after watcher is set up
      writeFileSync(triggerPath, "1");
      await new Promise((r) => setTimeout(r, 200));

      // Dir watcher detects creation, then file watcher is attached.
      // Mutate again to test the file watcher that was attached on detection.
      writeFileSync(triggerPath, "2");
      await new Promise((r) => setTimeout(r, 200));

      expect(reloads.length).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.close();
      rmSync(freshDir, { recursive: true, force: true });
    }
  });
});
