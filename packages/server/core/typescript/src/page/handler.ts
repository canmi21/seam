/* packages/server/core/typescript/src/page/handler.ts */

import { inject, escapeHtml } from "@canmi/seam-injector";
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

/** Flatten keyed loader results: spread object values into a flat map for slot resolution */
function flattenForSlots(keyed: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...keyed };
  for (const value of Object.values(keyed)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(merged, value as Record<string, unknown>);
    }
  }
  return merged;
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

/** Split-inject a layout template around its outlet marker */
function injectLayout(template: string, data: Record<string, unknown>, inner: string): string {
  const outletMarker = "<!--seam:outlet-->";
  const outletIdx = template.indexOf(outletMarker);
  if (outletIdx === -1) {
    return inject(template, data, { skipDataScript: true });
  }
  const before = template.slice(0, outletIdx);
  const after = template.slice(outletIdx + outletMarker.length);
  const injectedBefore = inject(before, data, { skipDataScript: true });
  const injectedAfter = inject(after, data, { skipDataScript: true });
  return injectedBefore + inner + injectedAfter;
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

/** Escape non-ASCII chars in JSON string values to \uXXXX */
function asciiEscapeJson(json: string): string {
  return json.replace(/[\u0080-\uffff]/gu, (c) => {
    const code = c.codePointAt(0)!;
    if (code > 0xffff) {
      const hi = Math.floor((code - 0x10000) / 0x400) + 0xd800;
      const lo = ((code - 0x10000) % 0x400) + 0xdc00;
      return `\\u${hi.toString(16)}\\u${lo.toString(16)}`;
    }
    return `\\u${code.toString(16).padStart(4, "0")}`;
  });
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

    // Partition: first N results are layout, last is page
    const layoutResults = loaderResults.slice(0, layoutChain.length);
    const pageKeyed = loaderResults[loaderResults.length - 1];

    // Select locale-specific template
    const pageTemplate = selectTemplate(page.template, page.localeTemplates, locale);

    // Inject page template
    let innerContent = inject(pageTemplate, flattenForSlots(pageKeyed), { skipDataScript: true });

    // Compose layouts from innermost to outermost
    const layoutKeyed: Record<string, Record<string, unknown>> = {};
    for (let i = layoutChain.length - 1; i >= 0; i--) {
      const layout = layoutChain[i];
      const data = layoutResults[i];
      layoutKeyed[layout.id] = data;
      const layoutTemplate = selectTemplate(layout.template, layout.localeTemplates, locale);
      innerContent = injectLayout(layoutTemplate, flattenForSlots(data), innerContent);
    }

    // Inject page-level metadata (<title>, <meta>, <link>) into <head>.
    // These were extracted from the page fragment at build time so they don't
    // end up inside the root div via <!--seam:outlet--> substitution.
    // Inserted after <meta charset="utf-8"> so page <title> wins over layout metadata
    // (first <title> wins in HTML5).
    if (page.headMeta) {
      const injectedMeta = inject(page.headMeta, flattenForSlots(pageKeyed), {
        skipDataScript: true,
      });
      const charset = '<meta charset="utf-8">';
      const charsetIdx = innerContent.indexOf(charset);
      if (charsetIdx !== -1) {
        const insertAt = charsetIdx + charset.length;
        innerContent =
          innerContent.slice(0, insertAt) + injectedMeta + innerContent.slice(insertAt);
      }
    }

    // Set <html lang="..."> when locale is known
    if (locale) {
      innerContent = innerContent.replace(/<html(?=[\s>])/, `<html lang="${locale}"`);
    }

    // Build __SEAM_DATA__: page data at top level, layout data under _layouts
    const seamData: Record<string, unknown> = { ...pageKeyed };
    if (Object.keys(layoutKeyed).length > 0) {
      seamData._layouts = layoutKeyed;
    }

    // Inject i18n data so the client can hydrate with matching translations
    if (i18nOpts) {
      const { config } = i18nOpts;
      const allMessages = config.messages[i18nOpts.locale] ?? {};
      const i18nData: Record<string, unknown> = {
        locale: i18nOpts.locale,
        messages: filterByKeys(allMessages, page.i18nKeys),
      };
      // Include fallback messages when locale differs from default
      if (i18nOpts.locale !== config.default) {
        const allFallback = config.messages[config.default] ?? {};
        i18nData.fallbackMessages = filterByKeys(allFallback, page.i18nKeys);
      }
      if (config.versions) {
        i18nData.versions = config.versions;
      }
      seamData._i18n = i18nData;
    }

    const dataId = page.dataId ?? "__SEAM_DATA__";
    const script = `<script id="${dataId}" type="application/json">${asciiEscapeJson(JSON.stringify(seamData))}</script>`;
    const bodyClose = innerContent.lastIndexOf("</body>");
    let html: string;
    if (bodyClose !== -1) {
      html = innerContent.slice(0, bodyClose) + script + innerContent.slice(bodyClose);
    } else {
      html = innerContent + script;
    }

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
