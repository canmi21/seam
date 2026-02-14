/* packages/client/react/__tests__/build-skeletons.test.ts */

import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildSentinelData } from "../src/sentinel.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("buildSentinelData", () => {
  it("converts flat object to sentinels", () => {
    const result = buildSentinelData({ name: "Alice", age: 30 });
    expect(result).toEqual({
      name: "%%SEAM:name%%",
      age: "%%SEAM:age%%",
    });
  });

  it("converts nested object with dotted paths", () => {
    const result = buildSentinelData({
      user: { name: "Alice", email: "alice@example.com" },
    });
    expect(result).toEqual({
      user: {
        name: "%%SEAM:user.name%%",
        email: "%%SEAM:user.email%%",
      },
    });
  });

  it("treats arrays as leaf values", () => {
    const result = buildSentinelData({ tags: ["a", "b"] });
    expect(result).toEqual({ tags: "%%SEAM:tags%%" });
  });

  it("handles null values as leaves", () => {
    const result = buildSentinelData({ avatar: null });
    expect(result).toEqual({ avatar: "%%SEAM:avatar%%" });
  });

  it("handles deeply nested objects", () => {
    const result = buildSentinelData({
      a: { b: { c: "deep" } },
    });
    expect(result).toEqual({
      a: { b: { c: "%%SEAM:a.b.c%%" } },
    });
  });

  it("handles empty object", () => {
    const result = buildSentinelData({});
    expect(result).toEqual({});
  });

  it("handles mixed nested and flat fields", () => {
    const result = buildSentinelData({
      id: 1,
      user: { name: "Alice", avatar: "url" },
      active: true,
    });
    expect(result).toEqual({
      id: "%%SEAM:id%%",
      user: {
        name: "%%SEAM:user.name%%",
        avatar: "%%SEAM:user.avatar%%",
      },
      active: "%%SEAM:active%%",
    });
  });
});

describe("build-skeletons.mjs integration", () => {
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renders a minimal component and produces valid JSON output", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "seam-skeleton-int-"));

    // Minimal routes file that exports a route array
    const routesContent = `
import React from "react";
import { defineRoutes, useSeamData } from "@canmi/seam-react";

function Hello() {
  const { greeting } = useSeamData();
  return React.createElement("p", null, greeting);
}

export default defineRoutes([{
  path: "/",
  component: Hello,
  loaders: { greeting: { procedure: "getGreeting" } },
  mock: { greeting: "Hello World" },
}]);
`;
    const routesFile = join(tmpDir, "routes.tsx");
    writeFileSync(routesFile, routesContent);

    const scriptPath = resolve(__dirname, "../scripts/build-skeletons.mjs");
    const stdout = execSync(`node ${scriptPath} ${routesFile}`, {
      cwd: tmpDir,
      encoding: "utf-8",
      // node_modules resolution needs the monorepo root
      env: { ...process.env, NODE_PATH: resolve(__dirname, "../../..") },
    });

    const output = JSON.parse(stdout);
    expect(output.routes).toHaveLength(1);
    expect(output.routes[0].path).toBe("/");
    expect(output.routes[0].fullHtml).toContain("%%SEAM:greeting%%");
    expect(output.routes[0].loaders).toEqual({ greeting: { procedure: "getGreeting" } });
  });
});
