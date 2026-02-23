/* packages/server/core/typescript/src/page/build-loader.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageDef, LoaderFn, LoaderResult } from "./index.js";

interface RouteManifest {
  layouts?: Record<string, { template: string }>;
  routes: Record<string, RouteManifestEntry>;
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

export function loadBuildOutput(distDir: string): Record<string, PageDef> {
  const manifestPath = join(distDir, "route-manifest.json");
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as RouteManifest;

  // Load layout templates
  const layoutTemplates: Record<string, string> = {};
  if (manifest.layouts) {
    for (const [id, entry] of Object.entries(manifest.layouts)) {
      layoutTemplates[id] = readFileSync(join(distDir, entry.template), "utf-8");
    }
  }

  const pages: Record<string, PageDef> = {};
  for (const [path, entry] of Object.entries(manifest.routes)) {
    const templatePath = join(distDir, entry.template);
    const template = readFileSync(templatePath, "utf-8");

    const loaders: Record<string, LoaderFn> = {};
    for (const [key, loaderConfig] of Object.entries(entry.loaders)) {
      loaders[key] = buildLoaderFn(loaderConfig);
    }

    const layoutTemplate = entry.layout ? layoutTemplates[entry.layout] : undefined;
    pages[path] = { template, layoutTemplate, loaders };
  }
  return pages;
}
