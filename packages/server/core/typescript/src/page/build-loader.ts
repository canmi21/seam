/* packages/server/core/typescript/src/page/build-loader.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageDef, LayoutDef, LoaderFn, LoaderResult } from "./index.js";
import type { RpcHashMap } from "../http.js";

interface RouteManifest {
  layouts?: Record<string, LayoutManifestEntry>;
  routes: Record<string, RouteManifestEntry>;
}

interface LayoutManifestEntry {
  template: string;
  loaders?: Record<string, LoaderConfig>;
  parent?: string;
}

interface RouteManifestEntry {
  template: string;
  layout?: string;
  loaders: Record<string, LoaderConfig>;
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

/** Resolve parent chain for a layout, returning outer-to-inner order */
function resolveLayoutChain(
  layoutId: string,
  layoutEntries: Record<string, LayoutManifestEntry>,
  templates: Record<string, string>,
): LayoutDef[] {
  const chain: LayoutDef[] = [];
  let currentId: string | undefined = layoutId;

  while (currentId) {
    const entry: LayoutManifestEntry | undefined = layoutEntries[currentId];
    if (!entry) break;
    chain.push({
      id: currentId,
      template: templates[currentId],
      loaders: buildLoaderFns(entry.loaders ?? {}),
    });
    currentId = entry.parent;
  }

  // Reverse: we walked inner→outer, but want outer→inner
  chain.reverse();
  return chain;
}

/** Resolve layout chain with lazy template getters (re-read from disk on each access) */
function resolveLayoutChainDev(
  layoutId: string,
  layoutEntries: Record<string, LayoutManifestEntry>,
  distDir: string,
): LayoutDef[] {
  const chain: LayoutDef[] = [];
  let currentId: string | undefined = layoutId;

  while (currentId) {
    const entry: LayoutManifestEntry | undefined = layoutEntries[currentId];
    if (!entry) break;
    const layoutTemplatePath = join(distDir, entry.template);
    const def: LayoutDef = {
      id: currentId,
      template: "", // placeholder, overridden by getter
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

/** Load the RPC hash map from build output (returns undefined when obfuscation is off) */
export function loadRpcHashMap(distDir: string): RpcHashMap | undefined {
  const hashMapPath = join(distDir, "rpc-hash-map.json");
  try {
    return JSON.parse(readFileSync(hashMapPath, "utf-8")) as RpcHashMap;
  } catch {
    return undefined;
  }
}

export function loadBuildOutput(distDir: string): Record<string, PageDef> {
  const manifestPath = join(distDir, "route-manifest.json");
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as RouteManifest;

  // Load layout templates
  const layoutTemplates: Record<string, string> = {};
  const layoutEntries = manifest.layouts ?? {};
  for (const [id, entry] of Object.entries(layoutEntries)) {
    layoutTemplates[id] = readFileSync(join(distDir, entry.template), "utf-8");
  }

  const pages: Record<string, PageDef> = {};
  for (const [path, entry] of Object.entries(manifest.routes)) {
    const templatePath = join(distDir, entry.template);
    const template = readFileSync(templatePath, "utf-8");

    const loaders = buildLoaderFns(entry.loaders);
    const layoutChain = entry.layout
      ? resolveLayoutChain(entry.layout, layoutEntries, layoutTemplates)
      : [];

    pages[path] = { template, loaders, layoutChain };
  }
  return pages;
}

/** Load build output with lazy template getters — templates re-read from disk on each access */
export function loadBuildOutputDev(distDir: string): Record<string, PageDef> {
  const manifestPath = join(distDir, "route-manifest.json");
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as RouteManifest;

  const layoutEntries = manifest.layouts ?? {};

  const pages: Record<string, PageDef> = {};
  for (const [path, entry] of Object.entries(manifest.routes)) {
    const templatePath = join(distDir, entry.template);
    const loaders = buildLoaderFns(entry.loaders);
    const layoutChain = entry.layout
      ? resolveLayoutChainDev(entry.layout, layoutEntries, distDir)
      : [];

    const page: PageDef = {
      template: "", // placeholder, overridden by getter
      loaders,
      layoutChain,
    };
    Object.defineProperty(page, "template", {
      get: () => readFileSync(templatePath, "utf-8"),
      enumerable: true,
    });
    pages[path] = page;
  }
  return pages;
}
