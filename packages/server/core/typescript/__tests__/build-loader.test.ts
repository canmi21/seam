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

describe("loadBuildOutput — i18n manifest", () => {
  let i18nDir: string;

  beforeAll(() => {
    i18nDir = mkdtempSync(join(tmpdir(), "seam-i18n-"));
    mkdirSync(join(i18nDir, "templates/origin"), { recursive: true });
    mkdirSync(join(i18nDir, "templates/zh"), { recursive: true });

    writeFileSync(join(i18nDir, "templates/origin/index.html"), "<h1><!--seam:page.title--></h1>");
    writeFileSync(
      join(i18nDir, "templates/origin/_layout_root.html"),
      "<html><body><!--seam:outlet--></body></html>",
    );
    writeFileSync(join(i18nDir, "templates/zh/index.html"), "<h1>ZH <!--seam:page.title--></h1>");
    writeFileSync(
      join(i18nDir, "templates/zh/_layout_root.html"),
      "<html><body>ZH <!--seam:outlet--></body></html>",
    );

    writeFileSync(
      join(i18nDir, "route-manifest.json"),
      JSON.stringify({
        routes: {
          "/": {
            templates: {
              origin: "templates/origin/index.html",
              zh: "templates/zh/index.html",
            },
            layout: "root",
            loaders: { page: { procedure: "getPage" } },
          },
        },
        layouts: {
          root: {
            templates: {
              origin: "templates/origin/_layout_root.html",
              zh: "templates/zh/_layout_root.html",
            },
          },
        },
        data_id: "__sd",
        i18n: { locales: ["origin", "zh"], default: "origin" },
      }),
    );
  });

  afterAll(() => {
    rmSync(i18nDir, { recursive: true, force: true });
  });

  it("loads default locale template", () => {
    const pages = loadBuildOutput(i18nDir);
    expect(pages["/"].template).toBe("<h1><!--seam:page.title--></h1>");
  });

  it("loads layout from default locale", () => {
    const pages = loadBuildOutput(i18nDir);
    expect(pages["/"].layoutChain).toHaveLength(1);
    expect(pages["/"].layoutChain[0].template).toBe("<html><body><!--seam:outlet--></body></html>");
  });

  it("preserves dataId", () => {
    const pages = loadBuildOutput(i18nDir);
    expect(pages["/"].dataId).toBe("__sd");
  });

  it("missing locale throws", () => {
    const badDir = mkdtempSync(join(tmpdir(), "seam-i18n-bad-locale-"));
    mkdirSync(join(badDir, "templates/origin"), { recursive: true });
    writeFileSync(join(badDir, "templates/origin/index.html"), "<p>ok</p>");
    writeFileSync(
      join(badDir, "route-manifest.json"),
      JSON.stringify({
        routes: {
          "/": {
            templates: { origin: "templates/origin/index.html" },
            loaders: {},
          },
        },
        i18n: { locales: ["origin", "fr"], default: "fr" },
      }),
    );
    try {
      expect(() => loadBuildOutput(badDir)).toThrow(/No template for locale "fr"/);
    } finally {
      rmSync(badDir, { recursive: true, force: true });
    }
  });

  it("neither field throws", () => {
    const badDir = mkdtempSync(join(tmpdir(), "seam-i18n-no-field-"));
    writeFileSync(
      join(badDir, "route-manifest.json"),
      JSON.stringify({
        routes: {
          "/": { loaders: {} },
        },
      }),
    );
    try {
      expect(() => loadBuildOutput(badDir)).toThrow(/neither 'template' nor 'templates'/);
    } finally {
      rmSync(badDir, { recursive: true, force: true });
    }
  });
});

describe("loadBuildOutputDev — i18n manifest", () => {
  let i18nDir: string;

  beforeAll(() => {
    i18nDir = mkdtempSync(join(tmpdir(), "seam-i18n-dev-"));
    mkdirSync(join(i18nDir, "templates/origin"), { recursive: true });
    mkdirSync(join(i18nDir, "templates/zh"), { recursive: true });

    writeFileSync(join(i18nDir, "templates/origin/index.html"), "<h1><!--seam:page.title--></h1>");
    writeFileSync(
      join(i18nDir, "templates/origin/_layout_root.html"),
      "<html><body><!--seam:outlet--></body></html>",
    );
    writeFileSync(join(i18nDir, "templates/zh/index.html"), "<h1>ZH <!--seam:page.title--></h1>");
    writeFileSync(
      join(i18nDir, "templates/zh/_layout_root.html"),
      "<html><body>ZH <!--seam:outlet--></body></html>",
    );

    writeFileSync(
      join(i18nDir, "route-manifest.json"),
      JSON.stringify({
        routes: {
          "/": {
            templates: {
              origin: "templates/origin/index.html",
              zh: "templates/zh/index.html",
            },
            layout: "root",
            loaders: { page: { procedure: "getPage" } },
          },
        },
        layouts: {
          root: {
            templates: {
              origin: "templates/origin/_layout_root.html",
              zh: "templates/zh/_layout_root.html",
            },
          },
        },
        data_id: "__sd",
        i18n: { locales: ["origin", "zh"], default: "origin" },
      }),
    );
  });

  afterAll(() => {
    rmSync(i18nDir, { recursive: true, force: true });
  });

  it("dev mode lazy getter resolves i18n template", () => {
    const pages = loadBuildOutputDev(i18nDir);
    expect(pages["/"].template).toBe("<h1><!--seam:page.title--></h1>");
  });

  it("dev mode layout chain resolves i18n template", () => {
    const pages = loadBuildOutputDev(i18nDir);
    expect(pages["/"].layoutChain).toHaveLength(1);
    expect(pages["/"].layoutChain[0].template).toBe("<html><body><!--seam:outlet--></body></html>");
  });
});
