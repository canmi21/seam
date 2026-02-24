/* packages/server/core/typescript/__tests__/build-loader.test.ts */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadBuildOutput, loadBuildOutputDev, loadRpcHashMap } from "../src/page/build-loader.js";

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

describe("loadBuildOutput — head_meta", () => {
  it("loads head_meta from manifest into headMeta field", () => {
    const dir = mkdtempSync(join(tmpdir(), "seam-headmeta-"));
    mkdirSync(join(dir, "templates"));
    writeFileSync(join(dir, "templates/index.html"), "<p>body</p>");
    writeFileSync(
      join(dir, "route-manifest.json"),
      JSON.stringify({
        routes: {
          "/": {
            template: "templates/index.html",
            layout: "root",
            loaders: {},
            head_meta: "<title><!--seam:t--></title>",
          },
        },
        layouts: {
          root: {
            template: "templates/index.html",
            loaders: {},
          },
        },
      }),
    );
    try {
      const pages = loadBuildOutput(dir);
      expect(pages["/"].headMeta).toBe("<title><!--seam:t--></title>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("headMeta is undefined when head_meta absent from manifest", () => {
    const pages = loadBuildOutput(distDir);
    expect(pages["/user/:id"].headMeta).toBeUndefined();
  });
});

describe("loadBuildOutput — data_id", () => {
  it("sets dataId from manifest data_id field", () => {
    const dir = mkdtempSync(join(tmpdir(), "seam-dataid-"));
    mkdirSync(join(dir, "templates"));
    writeFileSync(join(dir, "templates/index.html"), "<p>body</p>");
    writeFileSync(
      join(dir, "route-manifest.json"),
      JSON.stringify({
        routes: {
          "/": {
            template: "templates/index.html",
            loaders: {},
          },
        },
        data_id: "__sd",
      }),
    );
    try {
      const pages = loadBuildOutput(dir);
      expect(pages["/"].dataId).toBe("__sd");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dataId is undefined when data_id absent from manifest", () => {
    const pages = loadBuildOutput(distDir);
    expect(pages["/user/:id"].dataId).toBeUndefined();
  });
});

describe("loadRpcHashMap", () => {
  it("returns hash map when file exists", () => {
    const hashDir = mkdtempSync(join(tmpdir(), "seam-hashmap-"));
    writeFileSync(
      join(hashDir, "rpc-hash-map.json"),
      JSON.stringify({
        salt: "abcd1234abcd1234",
        batch: "e5f6a7b8",
        procedures: { getUser: "a1b2c3d4", getSession: "c9d0e1f2" },
      }),
    );
    try {
      const map = loadRpcHashMap(hashDir);
      expect(map).toBeDefined();
      expect(map!.batch).toBe("e5f6a7b8");
      expect(map!.procedures.getUser).toBe("a1b2c3d4");
    } finally {
      rmSync(hashDir, { recursive: true, force: true });
    }
  });

  it("returns undefined when file does not exist", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "seam-no-hashmap-"));
    try {
      const map = loadRpcHashMap(emptyDir);
      expect(map).toBeUndefined();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("loadBuildOutputDev", () => {
  it("loads pages with correct routes", () => {
    const pages = loadBuildOutputDev(distDir);
    expect(Object.keys(pages)).toEqual(["/user/:id", "/about"]);
  });

  it("returns fresh template content on each access", () => {
    const pages = loadBuildOutputDev(distDir);
    const first = pages["/user/:id"].template;
    expect(first).toContain("<!--seam:user.name-->");

    // Modify template on disk
    const tplPath = join(distDir, "templates/user-id.html");
    writeFileSync(tplPath, "<!DOCTYPE html><html><body>UPDATED</body></html>");

    const second = pages["/user/:id"].template;
    expect(second).toContain("UPDATED");

    // Restore original
    writeFileSync(tplPath, "<!DOCTYPE html><html><body><!--seam:user.name--></body></html>");
  });

  it("creates loader functions that coerce int params", () => {
    const pages = loadBuildOutputDev(distDir);
    const result = pages["/user/:id"].loaders.user({ id: "42" });
    expect(result).toEqual({ procedure: "getUser", input: { id: 42 } });
  });

  it("throws when route-manifest.json is missing", () => {
    expect(() => loadBuildOutputDev("/nonexistent/path")).toThrow();
  });
});
