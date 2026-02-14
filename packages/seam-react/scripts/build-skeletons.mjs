import { build } from "esbuild";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setSSRData, clearSSRData } from "@canmi/seam-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

// -- Sentinel generation --

export function buildSentinelData(obj, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = buildSentinelData(value, path);
    } else {
      result[key] = `%%SEAM:${path}%%`;
    }
  }
  return result;
}

// Set a dotted path to null in a deep-cloned object
function setFieldNull(obj, dottedPath) {
  const clone = JSON.parse(JSON.stringify(obj));
  const parts = dottedPath.split(".");
  let cur = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === null || cur[parts[i]] === undefined || typeof cur[parts[i]] !== "object")
      return clone;
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = null;
  return clone;
}

// -- Route rendering --

function renderRoute(route) {
  const sentinelData = buildSentinelData(route.mock);
  setSSRData(sentinelData);
  const fullHtml = renderToString(createElement(route.component));
  clearSSRData();

  const nullableFields = route.nullable || [];
  const nulledHtmls = {};

  for (const field of nullableFields) {
    const nulledMock = setFieldNull(route.mock, field);
    const nulledSentinel = buildSentinelData(nulledMock);
    setSSRData(nulledSentinel);
    nulledHtmls[field] = renderToString(createElement(route.component));
    clearSSRData();
  }

  return {
    path: route.path,
    loaders: route.loaders,
    fullHtml,
    nullableFields,
    nulledHtmls,
  };
}

// -- Main --

async function main() {
  const routesFile = process.argv[2];
  if (!routesFile) {
    console.error("Usage: node build-skeletons.mjs <routes-file>");
    process.exit(1);
  }

  const absRoutes = resolve(routesFile);
  const outfile = join(__dirname, ".tmp-routes-bundle.mjs");

  // Bundle routes file with esbuild; keep react + seam-react external
  // so module-level state is shared with this script
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

    const output = { routes: routes.map(renderRoute) };
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
