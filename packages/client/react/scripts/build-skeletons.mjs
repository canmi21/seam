/* packages/client/react/scripts/build-skeletons.mjs */

import { build } from "esbuild";
import { readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SeamBuildError } from "./skeleton/render.mjs";
import { extractLayouts, flattenRoutes } from "./skeleton/layout.mjs";
import {
  parseComponentImports,
  computeComponentHashes,
  computeScriptHash,
} from "./skeleton/cache.mjs";
import { processLayoutsWithCache, processRoutesWithCache } from "./skeleton/process.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const routesFile = process.argv[2];
  const manifestFile = process.argv[3];
  const i18nArg = process.argv[4];

  if (!routesFile) {
    console.error("Usage: node build-skeletons.mjs <routes-file> [manifest-file] [i18n-json]");
    process.exit(1);
  }

  // Load manifest if provided
  let manifest = null;
  let manifestContent = "";
  if (manifestFile && manifestFile !== "none") {
    try {
      manifestContent = readFileSync(resolve(manifestFile), "utf-8");
      manifest = JSON.parse(manifestContent);
    } catch (e) {
      console.error(`warning: could not read manifest: ${e.message}`);
    }
  }

  // Parse i18n config if provided
  let i18n = null;
  if (i18nArg && i18nArg !== "none") {
    try {
      i18n = JSON.parse(i18nArg);
    } catch (e) {
      console.error(`warning: could not parse i18n config: ${e.message}`);
    }
  }

  const absRoutes = resolve(routesFile);
  const routesDir = dirname(absRoutes);
  const outfile = join(__dirname, ".tmp-routes-bundle.mjs");

  // Parse imports from source (before bundle) for component hash resolution
  const routesSource = readFileSync(absRoutes, "utf-8");
  const importMap = parseComponentImports(routesSource);

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
    const flat = flattenRoutes(routes);

    // Collect all unique component names for hashing
    const componentNames = new Set();
    for (const [, entry] of layoutMap) {
      if (entry.component?.name) componentNames.add(entry.component.name);
    }
    for (const route of flat) {
      if (route.component?.name) componentNames.add(route.component.name);
    }

    // Files to hash for script-level cache invalidation
    const skeletonDir = join(__dirname, "skeleton");
    const scriptFiles = [
      join(skeletonDir, "render.mjs"),
      join(skeletonDir, "schema.mjs"),
      join(skeletonDir, "layout.mjs"),
      join(skeletonDir, "cache.mjs"),
      join(skeletonDir, "process.mjs"),
      join(__dirname, "variant-generator.mjs"),
      join(__dirname, "mock-generator.mjs"),
    ];

    const [componentHashes, scriptHash] = await Promise.all([
      computeComponentHashes([...componentNames], importMap, routesDir),
      Promise.resolve(computeScriptHash(scriptFiles)),
    ]);

    // Set up cache directory
    const cacheDir = join(process.cwd(), ".seam", "cache", "skeletons");
    mkdirSync(cacheDir, { recursive: true });

    // Shared warning state passed through to all render functions
    const buildWarnings = [];
    const seenWarnings = new Set();
    const warnCtx = { buildWarnings, seenWarnings };

    const ctx = {
      componentHashes,
      scriptHash,
      manifestContent,
      manifest,
      cacheDir,
      i18n,
      warnCtx,
      stats: { hits: 0, misses: 0 },
    };

    const layouts = processLayoutsWithCache(layoutMap, ctx);
    const renderedRoutes = processRoutesWithCache(flat, ctx);

    const output = {
      layouts,
      routes: renderedRoutes,
      warnings: buildWarnings,
      cacheStats: ctx.stats,
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
