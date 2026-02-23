/* packages/client/react/scripts/build-skeletons.mjs */

import { build } from "esbuild";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SeamDataProvider, buildSentinelData } from "@canmi/seam-react";
import {
  collectStructuralAxes,
  cartesianProduct,
  buildVariantSentinel,
} from "./variant-generator.mjs";
import { generateMockFromSchema, flattenLoaderMock, deepMerge } from "./mock-generator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// -- Rendering --

function renderWithData(component, data) {
  return renderToString(createElement(SeamDataProvider, { value: data }, createElement(component)));
}

// -- Render guards --

class SeamBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeamBuildError";
  }
}

const buildWarnings = [];

// Matches React-injected resource hint <link> tags.
// Only rel values used by React's resource APIs are targeted (preload, dns-prefetch, preconnect,
// data-precedence); user-authored <link> tags (canonical, alternate, stylesheet) are unaffected.
const RESOURCE_HINT_RE =
  /<link[^>]+rel\s*=\s*"(?:preload|dns-prefetch|preconnect)"[^>]*>|<link[^>]+data-precedence[^>]*>/gi;

function installRenderTraps(violations, teardowns) {
  function trapCall(obj, prop, label) {
    const orig = obj[prop];
    obj[prop] = function () {
      violations.push({ severity: "error", reason: `${label} called during skeleton render` });
      throw new SeamBuildError(`${label} is not allowed in skeleton components`);
    };
    teardowns.push(() => {
      obj[prop] = orig;
    });
  }

  trapCall(globalThis, "fetch", "fetch()");
  trapCall(Math, "random", "Math.random()");
  trapCall(Date, "now", "Date.now()");
  if (globalThis.crypto?.randomUUID) {
    trapCall(globalThis.crypto, "randomUUID", "crypto.randomUUID()");
  }

  // Timer APIs — these don't affect renderToString output, but pending handles
  // prevent the build process from exiting (Node keeps the event loop alive).
  trapCall(globalThis, "setTimeout", "setTimeout()");
  trapCall(globalThis, "setInterval", "setInterval()");
  if (globalThis.setImmediate) {
    trapCall(globalThis, "setImmediate", "setImmediate()");
  }
  trapCall(globalThis, "queueMicrotask", "queueMicrotask()");

  // Trap browser globals (only if not already defined — these are undefined in Node;
  // typeof checks bypass getters, so `typeof window !== 'undefined'` remains safe)
  for (const name of ["window", "document", "localStorage"]) {
    if (!(name in globalThis)) {
      Object.defineProperty(globalThis, name, {
        get() {
          violations.push({ severity: "error", reason: `${name} accessed during skeleton render` });
          throw new SeamBuildError(`${name} is not available in skeleton components`);
        },
        configurable: true,
      });
      teardowns.push(() => {
        delete globalThis[name];
      });
    }
  }
}

function validateOutput(html, violations) {
  if (html.includes("<!--$!-->")) {
    violations.push({
      severity: "error",
      reason:
        "Suspense abort detected \u2014 a component used an unresolved async resource\n" +
        "  (e.g. use(promise)) inside a <Suspense> boundary, producing an incomplete\n" +
        "  template with fallback content baked in.\n" +
        "  Fix: remove use() from skeleton components. Async data belongs in loaders.",
    });
  }

  const hints = Array.from(html.matchAll(RESOURCE_HINT_RE));
  if (hints.length > 0) {
    violations.push({
      severity: "warning",
      reason:
        `stripped ${hints.length} resource hint <link> tag(s) injected by React's preload()/preinit().\n` +
        "  These are not data-driven and would cause hydration mismatch.",
    });
  }
}

function stripResourceHints(html) {
  return html.replace(RESOURCE_HINT_RE, "");
}

function guardedRender(routePath, component, data) {
  const violations = [];
  const teardowns = [];

  installRenderTraps(violations, teardowns);

  let html;
  try {
    html = renderWithData(component, data);
  } finally {
    for (const teardown of teardowns) teardown();
  }

  validateOutput(html, violations);

  const fatal = violations.filter((v) => v.severity === "error");
  if (fatal.length > 0) {
    const msg = fatal.map((v) => `[seam] error: ${routePath}\n  ${v.reason}`).join("\n\n");
    throw new SeamBuildError(msg);
  }

  // After fatal check, only warnings remain
  for (const v of violations) {
    buildWarnings.push(`[seam] warning: ${routePath}\n  ${v.reason}`);
  }
  if (violations.length > 0) {
    html = stripResourceHints(html);
  }

  return html;
}

/**
 * Merge loader procedure schemas from manifest into a combined page schema.
 * Each loader contributes its output schema fields to the top-level properties.
 */
function buildPageSchema(route, manifest) {
  if (!manifest) return null;

  const properties = {};

  for (const [loaderKey, loaderDef] of Object.entries(route.loaders || {})) {
    const procName = loaderDef.procedure;
    const proc = manifest.procedures?.[procName];
    if (!proc?.output) continue;

    // Always nest under the loader key so axis paths (e.g. "user.bio")
    // align with sentinel data paths built from mock (e.g. sentinel.user.bio).
    properties[loaderKey] = proc.output;
  }

  const result = {};
  if (Object.keys(properties).length > 0) result.properties = properties;
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Resolve mock data for a route: auto-generate from schema when available,
 * then deep-merge any user-provided partial mock on top.
 */
function resolveRouteMock(route, manifest) {
  const pageSchema = buildPageSchema(route, manifest);

  if (pageSchema) {
    const keyedMock = generateMockFromSchema(pageSchema);
    const autoMock = flattenLoaderMock(keyedMock);
    return route.mock ? deepMerge(autoMock, route.mock) : autoMock;
  }

  // No manifest (frontend-only mode) — mock is required
  if (route.mock) return route.mock;

  throw new SeamBuildError(
    `[seam] error: Mock data required for route "${route.path}"\n\n` +
      "  No procedure manifest found \u2014 cannot auto-generate mock data.\n" +
      "  Provide mock data in your route definition:\n\n" +
      "    defineRoutes([{\n" +
      `      path: "${route.path}",\n` +
      "      component: YourComponent,\n" +
      '      mock: { user: { name: "..." }, repos: [...] }\n' +
      "    }])\n\n" +
      "  Or switch to fullstack mode with typed Procedures\n" +
      "  to enable automatic mock generation from schema.",
  );
}

function renderRoute(route, manifest) {
  const mock = resolveRouteMock(route, manifest);
  const baseSentinel = buildSentinelData(mock);
  const pageSchema = buildPageSchema(route, manifest);
  const axes = pageSchema ? collectStructuralAxes(pageSchema, mock) : [];
  const combos = cartesianProduct(axes);

  const variants = combos.map((variant) => {
    const sentinel = buildVariantSentinel(baseSentinel, mock, variant);
    const html = guardedRender(route.path, route.component, sentinel);
    return { variant, html };
  });

  // Render with real mock data for CTR equivalence check
  const mockHtml = stripResourceHints(guardedRender(route.path, route.component, mock));

  return {
    path: route.path,
    loaders: route.loaders,
    layout: route._layoutId || undefined,
    axes,
    variants,
    mockHtml,
    mock,
    pageSchema,
  };
}

// -- Layout helpers --

function toLayoutId(path) {
  return path === "/"
    ? "_layout_root"
    : `_layout_${path.replace(/^\/|\/$/g, "").replace(/\//g, "-")}`;
}

/** Extract layout components and metadata from route tree */
function extractLayouts(routes) {
  const seen = new Map();
  (function walk(defs, parentId) {
    for (const def of defs) {
      if (def.layout && def.children) {
        const id = toLayoutId(def.path);
        if (!seen.has(id)) {
          seen.set(id, {
            component: def.layout,
            loaders: def.loaders || {},
            mock: def.mock || null,
            parentId: parentId || null,
          });
        }
        walk(def.children, id);
      }
    }
  })(routes, null);
  return seen;
}

/** Render layout with seam-outlet placeholder, optionally with sentinel data */
function renderLayout(LayoutComponent, id, mock) {
  const data = mock ? buildSentinelData(mock) : {};
  function LayoutWithOutlet() {
    return createElement(LayoutComponent, null, createElement("seam-outlet", null));
  }
  return guardedRender(`layout:${id}`, LayoutWithOutlet, data);
}

/** Flatten routes, annotating each leaf with its parent layout id */
function flattenRoutes(routes, currentLayout) {
  const leaves = [];
  for (const route of routes) {
    if (route.layout && route.children) {
      leaves.push(...flattenRoutes(route.children, toLayoutId(route.path)));
    } else if (route.children) {
      leaves.push(...flattenRoutes(route.children, currentLayout));
    } else {
      if (currentLayout) route._layoutId = currentLayout;
      leaves.push(route);
    }
  }
  return leaves;
}

// -- Main --

async function main() {
  const routesFile = process.argv[2];
  const manifestFile = process.argv[3];

  if (!routesFile) {
    console.error("Usage: node build-skeletons.mjs <routes-file> [manifest-file]");
    process.exit(1);
  }

  // Load manifest if provided
  let manifest = null;
  if (manifestFile && manifestFile !== "none") {
    try {
      manifest = JSON.parse(readFileSync(resolve(manifestFile), "utf-8"));
    } catch (e) {
      console.error(`warning: could not read manifest: ${e.message}`);
    }
  }

  const absRoutes = resolve(routesFile);
  const outfile = join(__dirname, ".tmp-routes-bundle.mjs");

  await build({
    entryPoints: [absRoutes],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    external: ["react", "react-dom", "@canmi/seam-react"],
  });

  try {
    const mod = await import(outfile);
    const routes = mod.default || mod.routes;
    if (!Array.isArray(routes)) {
      throw new Error("Routes file must export default or named 'routes' as an array");
    }

    const layoutMap = extractLayouts(routes);
    const layouts = [...layoutMap.entries()].map(([id, entry]) => ({
      id,
      html: renderLayout(entry.component, id, entry.mock),
      loaders: entry.loaders,
      parent: entry.parentId,
    }));
    const flat = flattenRoutes(routes);
    const output = {
      layouts,
      routes: flat.map((r) => renderRoute(r, manifest)),
      warnings: buildWarnings,
    };
    process.stdout.write(JSON.stringify(output));
  } finally {
    try {
      unlinkSync(outfile);
    } catch {}
  }
}

main().catch((err) => {
  if (err instanceof SeamBuildError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
