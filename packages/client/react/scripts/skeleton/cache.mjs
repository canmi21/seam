/* packages/client/react/scripts/skeleton/cache.mjs */

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createI18n } from "@canmi/seam-i18n";

/** Parse import statements to map local names to specifiers */
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
          map.set(asMatch[1], specifier);
        } else {
          map.set(t, specifier);
        }
      }
    }
  }
  return map;
}

/** Bundle each component via esbuild (write: false) and SHA-256 hash the output */
async function computeComponentHashes(names, importMap, routesDir) {
  const hashes = new Map();
  const seen = new Set();
  const tasks = [];
  for (const name of names) {
    const specifier = importMap.get(name);
    if (!specifier || seen.has(specifier)) continue;
    seen.add(specifier);
    tasks.push(
      build({
        stdin: { contents: `import '${specifier}'`, resolveDir: routesDir, loader: "js" },
        bundle: true,
        write: false,
        format: "esm",
        platform: "node",
        treeShaking: false,
        external: ["react", "react-dom", "@canmi/seam-react", "@canmi/seam-i18n"],
        logLevel: "silent",
      })
        .then((result) => {
          const content = result.outputFiles[0]?.text || "";
          const hash = createHash("sha256").update(content).digest("hex");
          for (const [n, s] of importMap) {
            if (s === specifier) hashes.set(n, hash);
          }
        })
        .catch(() => {}),
    );
  }
  await Promise.all(tasks);
  return hashes;
}

/**
 * Hash the build scripts themselves to invalidate cache when tooling changes.
 * @param {string[]} scriptFiles - absolute paths of script files to hash
 */
function computeScriptHash(scriptFiles) {
  const h = createHash("sha256");
  for (const f of scriptFiles) h.update(readFileSync(f, "utf-8"));
  return h.digest("hex");
}

function pathToSlug(path) {
  const t = path
    .replace(/^\/|\/$/g, "")
    .replace(/\//g, "-")
    .replace(/:/g, "");
  return t || "index";
}

function readCache(cacheDir, slug) {
  try {
    return JSON.parse(readFileSync(join(cacheDir, `${slug}.json`), "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(cacheDir, slug, key, data) {
  writeFileSync(join(cacheDir, `${slug}.json`), JSON.stringify({ key, data }));
}

function computeCacheKey(componentHash, manifestContent, config, scriptHash, locale, messagesJson) {
  const h = createHash("sha256");
  h.update(componentHash);
  h.update(manifestContent);
  h.update(JSON.stringify(config));
  h.update(scriptHash);
  if (locale) h.update(locale);
  if (messagesJson) h.update(messagesJson);
  return h.digest("hex").slice(0, 16);
}

function buildI18nValue(locale, messages, defaultLocale) {
  const localeMessages = messages?.[locale] || {};
  const fallback =
    defaultLocale && locale !== defaultLocale ? messages?.[defaultLocale] || {} : undefined;
  const instance = createI18n(locale, localeMessages, fallback);
  const usedKeys = new Set();
  const origT = instance.t;
  return {
    locale: instance.locale,
    t(key, params) {
      usedKeys.add(key);
      return origT(key, params);
    },
    _usedKeys: usedKeys,
  };
}

export {
  parseComponentImports,
  computeComponentHashes,
  computeScriptHash,
  pathToSlug,
  readCache,
  writeCache,
  computeCacheKey,
  buildI18nValue,
};
