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
    const html = renderWithData(route.component, sentinel);
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

    const output = { routes: routes.map((r) => renderRoute(r, manifest)) };
    process.stdout.write(JSON.stringify(output));
  } finally {
    try {
      unlinkSync(outfile);
    } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
