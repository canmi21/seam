/* packages/server/core/typescript/src/page/build-loader.ts */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageDef, LayoutDef, LoaderFn, LoaderResult, I18nConfig } from "./index.js";
import type { RpcHashMap } from "../http.js";

interface RouteManifest {
  layouts?: Record<string, LayoutManifestEntry>;
  routes: Record<string, RouteManifestEntry>;
  data_id?: string;
  i18n?: { locales: string[]; default: string };
}

interface LayoutManifestEntry {
  template?: string;
  templates?: Record<string, string>;
  loaders?: Record<string, LoaderConfig>;
  parent?: string;
  i18n_keys?: string[];
}

interface RouteManifestEntry {
  template?: string;
  templates?: Record<string, string>;
  layout?: string;
  loaders: Record<string, LoaderConfig>;
  head_meta?: string;
  i18n_keys?: string[];
}

interface LoaderConfig {
  procedure: string;
  params?: Record<string, ParamConfig>;
}

interface ParamConfig {
  from: "route";
  type?: "string" | "int";
}

function buildLoaderFn(config: LoaderConfig): LoaderFn {
  return (params: Record<string, string>): LoaderResult => {
    const input: Record<string, unknown> = {};
    if (config.params) {
      for (const [key, mapping] of Object.entries(config.params)) {
        const raw = params[key];
        input[key] = mapping.type === "int" ? Number(raw) : raw;
      }
    }
    return { procedure: config.procedure, input };
  };
}

function buildLoaderFns(configs: Record<string, LoaderConfig>): Record<string, LoaderFn> {
  const fns: Record<string, LoaderFn> = {};
  for (const [key, config] of Object.entries(configs)) {
    fns[key] = buildLoaderFn(config);
  }
  return fns;
}

function resolveTemplatePath(
  entry: { template?: string; templates?: Record<string, string> },
  defaultLocale: string | undefined,
): string {
  if (entry.template) return entry.template;
  if (entry.templates) {
    const locale = defaultLocale ?? Object.keys(entry.templates)[0];
    const path = entry.templates[locale];
    if (!path) throw new Error(`No template for locale "${locale}"`);
    return path;
  }
  throw new Error("Manifest entry has neither 'template' nor 'templates'");
}

/** Load all locale templates for a manifest entry, keyed by locale */
function loadLocaleTemplates(
  entry: { templates?: Record<string, string> },
  distDir: string,
): Record<string, string> | undefined {
  if (!entry.templates) return undefined;
  const result: Record<string, string> = {};
  for (const [locale, relPath] of Object.entries(entry.templates)) {
    result[locale] = readFileSync(join(distDir, relPath), "utf-8");
  }
  return result;
}

/** Resolve parent chain for a layout, returning outer-to-inner order */
function resolveLayoutChain(
  layoutId: string,
  layoutEntries: Record<string, LayoutManifestEntry>,
  templates: Record<string, string>,
  localeTemplatesMap: Record<string, Record<string, string>>,
): LayoutDef[] {
  const chain: LayoutDef[] = [];
  let currentId: string | undefined = layoutId;

  while (currentId) {
    const entry: LayoutManifestEntry | undefined = layoutEntries[currentId];
    if (!entry) break;
    chain.push({
      id: currentId,
      template: templates[currentId],
      localeTemplates: localeTemplatesMap[currentId],
      loaders: buildLoaderFns(entry.loaders ?? {}),
    });
    currentId = entry.parent;
  }

  // Reverse: we walked inner->outer, but want outer->inner
  chain.reverse();
  return chain;
}

/** Resolve layout chain with lazy template getters (re-read from disk on each access) */
function resolveLayoutChainDev(
  layoutId: string,
  layoutEntries: Record<string, LayoutManifestEntry>,
  distDir: string,
  defaultLocale: string | undefined,
): LayoutDef[] {
  const chain: LayoutDef[] = [];
  let currentId: string | undefined = layoutId;

  while (currentId) {
    const entry: LayoutManifestEntry | undefined = layoutEntries[currentId];
    if (!entry) break;
    const layoutTemplatePath = join(distDir, resolveTemplatePath(entry, defaultLocale));
    const def: LayoutDef = {
      id: currentId,
      template: "", // placeholder, overridden by getter
      localeTemplates: entry.templates
        ? makeLocaleTemplateGetters(entry.templates, distDir)
        : undefined,
      loaders: buildLoaderFns(entry.loaders ?? {}),
    };
    Object.defineProperty(def, "template", {
      get: () => readFileSync(layoutTemplatePath, "utf-8"),
      enumerable: true,
    });
    chain.push(def);
    currentId = entry.parent;
  }

  chain.reverse();
  return chain;
}

/** Create a proxy object that lazily reads locale templates from disk */
function makeLocaleTemplateGetters(
  templates: Record<string, string>,
  distDir: string,
): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [locale, relPath] of Object.entries(templates)) {
    const fullPath = join(distDir, relPath);
    Object.defineProperty(obj, locale, {
      get: () => readFileSync(fullPath, "utf-8"),
      enumerable: true,
    });
  }
  return obj;
}

/** Merge i18n_keys from route + layout chain into a single list */
function mergeI18nKeys(
  route: RouteManifestEntry,
  layoutEntries: Record<string, LayoutManifestEntry>,
): string[] | undefined {
  const keys: string[] = [];
  if (route.layout) {
    let currentId: string | undefined = route.layout;
    while (currentId) {
      const entry: LayoutManifestEntry | undefined = layoutEntries[currentId];
      if (!entry) break;
      if (entry.i18n_keys) keys.push(...entry.i18n_keys);
      currentId = entry.parent;
    }
  }
  if (route.i18n_keys) keys.push(...route.i18n_keys);
  return keys.length > 0 ? keys : undefined;
}

/** Load the RPC hash map from build output (returns undefined when obfuscation is off) */
export function loadRpcHashMap(distDir: string): RpcHashMap | undefined {
  const hashMapPath = join(distDir, "rpc-hash-map.json");
  try {
    return JSON.parse(readFileSync(hashMapPath, "utf-8")) as RpcHashMap;
  } catch {
    return undefined;
  }
}

/** Load i18n messages from build output locales/ directory */
export function loadI18nMessages(distDir: string): I18nConfig | null {
  const manifestPath = join(distDir, "route-manifest.json");
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as RouteManifest;
    if (!manifest.i18n) return null;

    const messages: Record<string, Record<string, string>> = {};
    const localesDir = join(distDir, "locales");
    for (const locale of manifest.i18n.locales) {
      const localePath = join(localesDir, `${locale}.json`);
      if (existsSync(localePath)) {
        messages[locale] = JSON.parse(readFileSync(localePath, "utf-8")) as Record<string, string>;
      } else {
        messages[locale] = {};
      }
    }

    return {
      locales: manifest.i18n.locales,
      default: manifest.i18n.default,
      messages,
    };
  } catch {
    return null;
  }
}

export function loadBuildOutput(distDir: string): Record<string, PageDef> {
  const manifestPath = join(distDir, "route-manifest.json");
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as RouteManifest;
  const defaultLocale = manifest.i18n?.default;

  // Load layout templates (default + all locales)
  const layoutTemplates: Record<string, string> = {};
  const layoutLocaleTemplates: Record<string, Record<string, string>> = {};
  const layoutEntries = manifest.layouts ?? {};
  for (const [id, entry] of Object.entries(layoutEntries)) {
    layoutTemplates[id] = readFileSync(
      join(distDir, resolveTemplatePath(entry, defaultLocale)),
      "utf-8",
    );
    const lt = loadLocaleTemplates(entry, distDir);
    if (lt) layoutLocaleTemplates[id] = lt;
  }

  const pages: Record<string, PageDef> = {};
  for (const [path, entry] of Object.entries(manifest.routes)) {
    const templatePath = join(distDir, resolveTemplatePath(entry, defaultLocale));
    const template = readFileSync(templatePath, "utf-8");

    const loaders = buildLoaderFns(entry.loaders);
    const layoutChain = entry.layout
      ? resolveLayoutChain(entry.layout, layoutEntries, layoutTemplates, layoutLocaleTemplates)
      : [];

    // Merge i18n_keys from layout chain + route
    const i18nKeys = mergeI18nKeys(entry, layoutEntries);

    pages[path] = {
      template,
      localeTemplates: loadLocaleTemplates(entry, distDir),
      loaders,
      layoutChain,
      headMeta: entry.head_meta,
      dataId: manifest.data_id,
      i18nKeys,
    };
  }
  return pages;
}

/** Load build output with lazy template getters -- templates re-read from disk on each access */
export function loadBuildOutputDev(distDir: string): Record<string, PageDef> {
  const manifestPath = join(distDir, "route-manifest.json");
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as RouteManifest;
  const defaultLocale = manifest.i18n?.default;

  const layoutEntries = manifest.layouts ?? {};

  const pages: Record<string, PageDef> = {};
  for (const [path, entry] of Object.entries(manifest.routes)) {
    const templatePath = join(distDir, resolveTemplatePath(entry, defaultLocale));
    const loaders = buildLoaderFns(entry.loaders);
    const layoutChain = entry.layout
      ? resolveLayoutChainDev(entry.layout, layoutEntries, distDir, defaultLocale)
      : [];

    const localeTemplates = entry.templates
      ? makeLocaleTemplateGetters(entry.templates, distDir)
      : undefined;

    // Merge i18n_keys from layout chain + route
    const i18nKeys = mergeI18nKeys(entry, layoutEntries);

    const page: PageDef = {
      template: "", // placeholder, overridden by getter
      localeTemplates,
      loaders,
      layoutChain,
      dataId: manifest.data_id,
      i18nKeys,
    };
    Object.defineProperty(page, "template", {
      get: () => readFileSync(templatePath, "utf-8"),
      enumerable: true,
    });
    pages[path] = page;
  }
  return pages;
}
