/* packages/server/core/typescript/__tests__/build-loader.test.ts */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadBuildOutput } from "../src/page/build-loader.js";

let distDir: string;

beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), "seam-build-test-"));
  mkdirSync(join(distDir, "templates"));

  writeFileSync(
    join(distDir, "templates/user-id.html"),
    "<!DOCTYPE html><html><body><!--seam:user.name--></body></html>",
  );

  writeFileSync(
    join(distDir, "route-manifest.json"),
    JSON.stringify({
      routes: {
        "/user/:id": {
          template: "templates/user-id.html",
          loaders: {
            user: {
              procedure: "getUser",
              params: { id: { from: "route", type: "int" } },
            },
          },
        },
        "/about": {
          template: "templates/user-id.html",
          loaders: {
            info: {
              procedure: "getInfo",
              params: { slug: { from: "route" } },
            },
          },
        },
      },
    }),
  );
});

afterAll(() => {
  rmSync(distDir, { recursive: true, force: true });
});

describe("loadBuildOutput", () => {
  it("loads pages from dist directory", () => {
    const pages = loadBuildOutput(distDir);
    expect(Object.keys(pages)).toEqual(["/user/:id", "/about"]);
  });

  it("loads template content", () => {
    const pages = loadBuildOutput(distDir);
    expect(pages["/user/:id"].template).toContain("<!--seam:user.name-->");
  });

  it("creates loader functions that coerce int params", () => {
    const pages = loadBuildOutput(distDir);
    const result = pages["/user/:id"].loaders.user({ id: "42" });
    expect(result).toEqual({ procedure: "getUser", input: { id: 42 } });
  });

  it("creates loader functions with string params by default", () => {
    const pages = loadBuildOutput(distDir);
    const result = pages["/about"].loaders.info({ slug: "hello" });
    expect(result).toEqual({ procedure: "getInfo", input: { slug: "hello" } });
  });

  it("throws when route-manifest.json is missing", () => {
    expect(() => loadBuildOutput("/nonexistent/path")).toThrow();
  });

  it("throws on malformed manifest JSON", () => {
    const badDir = mkdtempSync(join(tmpdir(), "seam-bad-manifest-"));
    writeFileSync(join(badDir, "route-manifest.json"), "not valid json{{{");
    try {
      expect(() => loadBuildOutput(badDir)).toThrow();
    } finally {
      rmSync(badDir, { recursive: true, force: true });
    }
  });

  it("throws when referenced template file is missing", () => {
    const noTplDir = mkdtempSync(join(tmpdir(), "seam-no-tpl-"));
    writeFileSync(
      join(noTplDir, "route-manifest.json"),
      JSON.stringify({
        routes: {
          "/": {
            template: "templates/missing.html",
            loaders: {},
          },
        },
      }),
    );
    try {
      expect(() => loadBuildOutput(noTplDir)).toThrow();
    } finally {
      rmSync(noTplDir, { recursive: true, force: true });
    }
  });

  it("returns empty record for empty routes", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "seam-empty-routes-"));
    writeFileSync(join(emptyDir, "route-manifest.json"), JSON.stringify({ routes: {} }));
    try {
      const pages = loadBuildOutput(emptyDir);
      expect(pages).toEqual({});
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
