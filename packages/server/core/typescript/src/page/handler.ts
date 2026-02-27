/* packages/server/core/typescript/src/page/handler.ts */

import { renderPage, escapeHtml } from "@canmi/seam-engine";
import { SeamError } from "../errors.js";
import type { InternalProcedure } from "../procedure.js";
import type { PageDef, LoaderFn, I18nConfig } from "./index.js";

export interface PageTiming {
  /** Procedure execution time in milliseconds */
  dataFetch: number;
  /** Template injection time in milliseconds */
  inject: number;
}

export interface HandlePageResult {
  status: number;
  html: string;
  timing?: PageTiming;
}

export interface I18nOpts {
  locale: string;
  config: I18nConfig;
}

/** Execute loaders, returning keyed results */
async function executeLoaders(
  loaders: Record<string, LoaderFn>,
  params: Record<string, string>,
  procedures: Map<string, InternalProcedure>,
): Promise<Record<string, unknown>> {
  const entries = Object.entries(loaders);
  const results = await Promise.all(
    entries.map(async ([key, loader]) => {
      const { procedure, input } = loader(params);
      const proc = procedures.get(procedure);
      if (!proc) throw new SeamError("INTERNAL_ERROR", `Procedure '${procedure}' not found`);
      // Skip JTD validation -- loader input is trusted server-side code
      const result = await proc.handler({ input });
      return [key, result] as const;
    }),
  );
  return Object.fromEntries(results);
}

/** Select the template for a given locale, falling back to the default template */
function selectTemplate(
  defaultTemplate: string,
  localeTemplates: Record<string, string> | undefined,
  locale: string | undefined,
): string {
  if (locale && localeTemplates) {
    return localeTemplates[locale] ?? defaultTemplate;
  }
  return defaultTemplate;
}

/** Filter messages to only include keys in the allow list. Empty/undefined list means include all. */
function filterByKeys(
  messages: Record<string, string>,
  keys: string[] | undefined,
): Record<string, string> {
  if (!keys || keys.length === 0) return messages;
  const filtered: Record<string, string> = {};
  for (const k of keys) {
    if (k in messages) filtered[k] = messages[k];
  }
  return filtered;
}

export async function handlePageRequest(
  page: PageDef,
  params: Record<string, string>,
  procedures: Map<string, InternalProcedure>,
  i18nOpts?: I18nOpts,
): Promise<HandlePageResult> {
  try {
    const t0 = performance.now();
    const layoutChain = page.layoutChain ?? [];
    const locale = i18nOpts?.locale;

    // Execute all loaders (layout chain + page) in parallel
    const loaderResults = await Promise.all([
      ...layoutChain.map((layout) => executeLoaders(layout.loaders, params, procedures)),
      executeLoaders(page.loaders, params, procedures),
    ]);

    const t1 = performance.now();

    // Merge all loader data into a single object
    const allData: Record<string, unknown> = {};
    for (const result of loaderResults) {
      Object.assign(allData, result);
    }

    // Compose template: nest page inside layouts via outlet substitution
    const pageTemplate = selectTemplate(page.template, page.localeTemplates, locale);
    let composedTemplate = pageTemplate;
    for (let i = layoutChain.length - 1; i >= 0; i--) {
      const layout = layoutChain[i];
      const layoutTemplate = selectTemplate(layout.template, layout.localeTemplates, locale);
      composedTemplate = layoutTemplate.replace("<!--seam:outlet-->", composedTemplate);
    }

    // Build PageConfig for engine
    const config = {
      layout_chain: layoutChain.map((l) => ({
        id: l.id,
        loader_keys: Object.keys(l.loaders),
      })),
      data_id: page.dataId ?? "__SEAM_DATA__",
      head_meta: page.headMeta,
    };

    // Build I18nOpts for engine (server-side merge: default + target)
    let i18nOptsJson: string | undefined;
    if (i18nOpts) {
      const { config: i18nConfig } = i18nOpts;
      const targetMsgs = i18nConfig.messages[i18nOpts.locale] ?? {};
      const merged =
        i18nOpts.locale !== i18nConfig.default
          ? { ...(i18nConfig.messages[i18nConfig.default] ?? {}), ...targetMsgs }
          : targetMsgs;
      const i18nData: Record<string, unknown> = {
        locale: i18nOpts.locale,
        default_locale: i18nConfig.default,
        messages: filterByKeys(merged, page.i18nKeys),
      };
      i18nOptsJson = JSON.stringify(i18nData);
    }

    // Single WASM call: inject slots, compose data script, apply locale/meta
    const html = renderPage(
      composedTemplate,
      JSON.stringify(allData),
      JSON.stringify(config),
      i18nOptsJson,
    );

    const t2 = performance.now();

    return {
      status: 200,
      html,
      timing: { dataFetch: t1 - t0, inject: t2 - t1 },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      status: 500,
      html: `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>${escapeHtml(message)}</p></body></html>`,
    };
  }
}
