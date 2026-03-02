/* src/cli/pkg/scripts/build-frontend.mjs */

// Seam built-in frontend bundler powered by Rolldown.
// Usage: node|bun build-frontend.mjs <entry> <outdir>
//
// When SEAM_ROUTES_FILE is set, enables per-page code splitting:
// page components become separate entry chunks loaded on demand.

import { rolldown } from "rolldown";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const [entry, outDir = ".seam/dist"] = process.argv.slice(2);
if (!entry) {
  console.error("usage: build-frontend.mjs <entry> <outdir>");
  process.exit(1);
}

const cwd = process.cwd();

// -- PostCSS plugin (only loaded when postcss.config exists) --

function loadPostcssConfig() {
  const names = ["postcss.config.js", "postcss.config.mjs", "postcss.config.cjs"];
  for (const name of names) {
    const full = path.join(cwd, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

async function resolvePostcssPlugins(configPath) {
  const require = createRequire(configPath);
  const config = (await import(configPath)).default;
  const plugins = [];
  for (const [name, opts] of Object.entries(config.plugins || {})) {
    const pluginFn = require(name);
    plugins.push((pluginFn.default || pluginFn)(opts || {}));
  }
  return plugins;
}

function postcssPlugin(postcssPlugins) {
  let postcss;
  const require = createRequire(path.join(cwd, "__placeholder__.js"));
  return {
    name: "seam-postcss",
    async transform(code, id) {
      if (!id.endsWith(".css")) return null;
      if (!postcss) {
        postcss = require("postcss");
      }
      const result = await postcss(postcssPlugins).process(code, { from: id });
      return { code: result.css, map: result.map?.toJSON() };
    },
  };
}

// -- RPC hash transform plugin (compile-time string replacement) --

function rpcHashPlugin() {
  const mapPath = process.env.SEAM_RPC_MAP_PATH;
  if (!mapPath) return null;
  let procedures = {};
  return {
    name: "seam-rpc-transform",
    buildStart() {
      try {
        const map = JSON.parse(fs.readFileSync(mapPath, "utf-8"));
        procedures = { ...map.procedures, _batch: map.batch };
      } catch {
        /* obfuscation off or file missing */
      }
    },
    transform(code, id) {
      if (!Object.keys(procedures).length) return null;
      if (id.includes("node_modules") && !id.includes("@canmi/seam-")) return null;
      let result = code;
      for (const [name, hash] of Object.entries(procedures)) {
        result = result.replaceAll(`"${name}"`, `"${hash}"`);
      }
      return result !== code ? { code: result } : null;
    },
  };
}

// -- Page splitting: route analysis + dynamic import transform --

/** Parse import statements from source, returning Map<localName, specifier> */
function parseComponentImports(source) {
  const map = new Map();
  const re = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const [, defaultName, namedPart, specifier] = m;
    if (defaultName) map.set(defaultName, specifier);
    if (namedPart) {
      for (const part of namedPart.split(",")) {
        const t = part.trim();
        if (!t) continue;
        const asMatch = t.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          map.set(asMatch[2], specifier);
        } else {
          map.set(t, specifier);
        }
      }
    }
  }
  return map;
}

/** Resolve a source file path, probing .tsx/.ts/.jsx/.js extensions */
function resolveSourcePath(p) {
  if (fs.existsSync(p)) return p;
  const base = p.replace(/\.[jt]sx?$/, "");
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return p;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Analyze routes file to build multi-entry input and a transform plugin.
 * Returns null when splitting is not applicable (0-1 page components).
 */
function analyzeRoutesForSplitting(routesFile) {
  const absRoutesFile = path.resolve(routesFile);
  if (!fs.existsSync(absRoutesFile)) return null;

  const source = fs.readFileSync(absRoutesFile, "utf-8");
  const importMap = parseComponentImports(source);

  // Find component references: `component: Name` or `component:Name`
  const componentRefs = new Set();
  const componentRe = /component\s*:\s*(\w+)/g;
  let match;
  while ((match = componentRe.exec(source)) !== null) {
    componentRefs.add(match[1]);
  }

  if (componentRefs.size < 2) return null; // splitting only helps with 2+ pages

  const routesDir = path.dirname(absRoutesFile);
  const entries = { main: entry };
  // Map: component local name -> { specifier, resolved path, entry name }
  const pageComponents = new Map();

  for (const name of componentRefs) {
    const specifier = importMap.get(name);
    if (!specifier) continue;
    const abs = path.resolve(routesDir, specifier);
    const resolved = resolveSourcePath(abs);
    if (!fs.existsSync(resolved)) continue;

    const baseName = path.basename(resolved, path.extname(resolved));
    const entryName = `page-${baseName}`;
    entries[entryName] = resolved;
    pageComponents.set(name, { specifier, resolved, entryName });
  }

  if (pageComponents.size < 2) return null;

  return { entries, pageComponents, absRoutesFile };
}

/**
 * Rolldown plugin: rewrite static page component imports to dynamic imports
 * in the routes file, enabling per-page code splitting.
 */
function pageSplitPlugin({ absRoutesFile, pageComponents }) {
  return {
    name: "seam-page-split",
    transform(code, id) {
      const absId = path.resolve(id);
      if (absId !== absRoutesFile) return null;

      let result = code;
      for (const [name, { specifier }] of pageComponents) {
        const escaped = escapeRegex(specifier);

        // Match: import { Name } from "specifier"
        const singleNamedRe = new RegExp(
          `import\\s*\\{\\s*${name}\\s*\\}\\s*from\\s*['"]${escaped}['"]\\s*;?`,
        );
        // Match: import Name from "specifier"
        const defaultRe = new RegExp(`import\\s+${name}\\s+from\\s*['"]${escaped}['"]\\s*;?`);

        const lazyDecl = `const ${name} = Object.assign(() => import("${specifier}").then(m => m.${name} || m.default), { __seamLazy: true });\n`;

        if (singleNamedRe.test(result)) {
          result = result.replace(singleNamedRe, lazyDecl);
        } else if (defaultRe.test(result)) {
          result = result.replace(defaultRe, lazyDecl);
        }
      }

      return result !== code ? { code: result } : null;
    },
  };
}

// -- Vite-compatible manifest generation --

/** Build a Vite-format manifest from Rolldown output chunks */
function buildViteManifest(chunks) {
  const manifest = {};

  // Index chunks by fileName for import resolution
  const chunkByFile = new Map();
  for (const chunk of chunks) {
    if (chunk.type === "chunk") {
      chunkByFile.set(chunk.fileName, chunk);
    }
  }

  for (const chunk of chunks) {
    if (chunk.type !== "chunk") continue;

    // Determine manifest key: source path for entry/dynamic-entry, internal name for shared chunks
    let key;
    if (chunk.facadeModuleId) {
      key = path.relative(cwd, chunk.facadeModuleId);
    } else {
      key = `_${path.basename(chunk.fileName, path.extname(chunk.fileName))}`;
    }

    const entry = {
      file: chunk.fileName,
      css: [],
    };

    if (chunk.isEntry) entry.isEntry = true;
    if (chunk.isDynamicEntry) entry.isDynamicEntry = true;

    // Resolve imports to manifest keys
    if (chunk.imports?.length) {
      entry.imports = chunk.imports.map((imp) => {
        const impChunk = chunkByFile.get(imp);
        if (impChunk?.facadeModuleId) {
          return path.relative(cwd, impChunk.facadeModuleId);
        }
        return `_${path.basename(imp, path.extname(imp))}`;
      });
    }

    manifest[key] = entry;
  }

  // Associate CSS assets with their entry chunks via shared module ancestry.
  // Rolldown emits CSS as top-level assets; assign to the main entry for now.
  const cssAssets = chunks
    .filter((c) => c.type === "asset" && c.fileName.endsWith(".css"))
    .map((c) => c.fileName);

  if (cssAssets.length > 0) {
    // Assign CSS to the main (non-dynamic) entry
    for (const entry of Object.values(manifest)) {
      if (entry.isEntry && !entry.isDynamicEntry) {
        entry.css = cssAssets;
        break;
      }
    }
  }

  return manifest;
}

// -- Main --

const plugins = [];

const rpcPlugin = rpcHashPlugin();
if (rpcPlugin) plugins.push(rpcPlugin);

const postcssConfigPath = loadPostcssConfig();
if (postcssConfigPath) {
  const postcssPlugins = await resolvePostcssPlugins(postcssConfigPath);
  plugins.push(postcssPlugin(postcssPlugins));
}

// Analyze routes for per-page splitting
const routesFile = process.env.SEAM_ROUTES_FILE;
const splitInfo = routesFile ? analyzeRoutesForSplitting(routesFile) : null;
const input = splitInfo ? splitInfo.entries : entry;

if (splitInfo) {
  plugins.push(pageSplitPlugin(splitInfo));
}

const bundle = await rolldown({
  input,
  plugins,
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  },
});

const { output } = await bundle.write({
  dir: outDir,
  format: "esm",
  entryFileNames: "assets/[name]-[hash].js",
  chunkFileNames: "assets/[name]-[hash].js",
  assetFileNames: "assets/[name]-[hash][extname]",
});

// -- Generate manifests --

const js = [];
const css = [];

for (const chunk of output) {
  if (chunk.type === "chunk" && chunk.isEntry) {
    js.push(chunk.fileName);
  } else if (chunk.type === "asset" && chunk.fileName.endsWith(".css")) {
    css.push(chunk.fileName);
  }
}

const manifestDir = path.join(outDir, ".seam");
fs.mkdirSync(manifestDir, { recursive: true });

// Simple manifest (backward compat, always written)
fs.writeFileSync(
  path.join(manifestDir, "manifest.json"),
  JSON.stringify({ js, css }, null, 2) + "\n",
);

// Vite-compatible manifest (written when multi-entry splitting is active)
if (splitInfo) {
  const viteManifest = buildViteManifest(output);
  fs.writeFileSync(
    path.join(manifestDir, "vite-manifest.json"),
    JSON.stringify(viteManifest, null, 2) + "\n",
  );
}
