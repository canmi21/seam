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

// Matches React-injected resource hint <link> tags, excluding user-authored ones with %%SEAM:
const RESOURCE_HINT_RE =
  /<link[^>]+rel\s*=\s*"(?:preload|stylesheet|dns-prefetch|preconnect)"[^>]*>/gi;

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

  const hints = Array.from(html.matchAll(RESOURCE_HINT_RE)).filter(
    (m) => !m[0].includes("%%SEAM:"),
  );
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
  return html.replace(RESOURCE_HINT_RE, (m) => (m.includes("%%SEAM:") ? m : ""));
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
  const optionalProperties = {};

  for (const [_loaderKey, loaderDef] of Object.entries(route.loaders || {})) {
    const procName = loaderDef.procedure;
    const proc = manifest.procedures?.[procName];
    if (!proc?.output) continue;

    const schema = proc.output;
    // Merge output schema properties into the page schema
    if (schema.properties) {
      Object.assign(properties, schema.properties);
    }
    if (schema.optionalProperties) {
      Object.assign(optionalProperties, schema.optionalProperties);
    }
    // If the output itself is an array or other non-object, wrap it under the loader key
    if (schema.elements || schema.type || schema.enum) {
      properties[_loaderKey] = schema;
    }
  }

  const result = {};
  if (Object.keys(properties).length > 0) result.properties = properties;
  if (Object.keys(optionalProperties).length > 0) result.optionalProperties = optionalProperties;
  return Object.keys(result).length > 0 ? result : null;
}

function renderRoute(route, manifest) {
  const baseSentinel = buildSentinelData(route.mock);
  const pageSchema = buildPageSchema(route, manifest);
  const axes = pageSchema ? collectStructuralAxes(pageSchema, route.mock) : [];
  const combos = cartesianProduct(axes);

  const variants = combos.map((variant) => {
    const sentinel = buildVariantSentinel(baseSentinel, route.mock, variant);
    const html = guardedRender(route.path, route.component, sentinel);
    return { variant, html };
  });

  return {
    path: route.path,
    loaders: route.loaders,
    axes,
    variants,
  };
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

    const output = { routes: routes.map((r) => renderRoute(r, manifest)), warnings: buildWarnings };
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
