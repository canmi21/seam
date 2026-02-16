/* packages/cli/pkg/scripts/build-frontend.mjs */

// Seam built-in frontend bundler powered by Rolldown.
// Usage: node|bun build-frontend.mjs <entry> <outdir>

import { rolldown } from "rolldown";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const [entry, outDir = "dist"] = process.argv.slice(2);
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

// -- Main --

const plugins = [];

const postcssConfigPath = loadPostcssConfig();
if (postcssConfigPath) {
  const postcssPlugins = await resolvePostcssPlugins(postcssConfigPath);
  plugins.push(postcssPlugin(postcssPlugins));
}

const bundle = await rolldown({
  input: entry,
  plugins,
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  },
});

const { output } = await bundle.write({
  dir: outDir,
  format: "esm",
  entryFileNames: "assets/[name]-[hash].js",
  assetFileNames: "assets/[name]-[hash][extname]",
});

// -- Generate Seam manifest --

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
fs.writeFileSync(
  path.join(manifestDir, "manifest.json"),
  JSON.stringify({ js, css }, null, 2) + "\n",
);
