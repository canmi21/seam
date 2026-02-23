/* packages/server/core/typescript/src/page/handler.ts */

import { inject, escapeHtml } from "@canmi/seam-injector";
import { SeamError } from "../errors.js";
import type { InternalProcedure } from "../procedure.js";
import type { PageDef } from "./index.js";

export interface PageTiming {
  /** Procedure execution time in milliseconds */
  dataFetch: number;
  /** Template injection time in milliseconds */
  inject: number;
}

export interface HandlePageResult {
  status: number;
  html: string;
  timing: PageTiming;
}

export async function handlePageRequest(
  page: PageDef,
  params: Record<string, string>,
  procedures: Map<string, InternalProcedure>,
): Promise<HandlePageResult> {
  try {
    const t0 = performance.now();

    const entries = Object.entries(page.loaders);
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

    const t1 = performance.now();

    // Build keyed data (e.g. { page: { ... } }) for __SEAM_DATA__,
    // and merge loader results flat for template slot resolution.
    const keyed = Object.fromEntries(results);
    const merged: Record<string, unknown> = { ...keyed };
    for (const [, value] of results) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(merged, value as Record<string, unknown>);
      }
    }
    // Render template with merged (flattened) data for slot resolution,
    // but inject keyed-only data into __SEAM_DATA__ for the client.
    let html = inject(page.template, merged, { skipDataScript: true });
    const script = `<script id="__SEAM_DATA__" type="application/json">${JSON.stringify(keyed)}</script>`;
    const bodyClose = html.lastIndexOf("</body>");
    if (bodyClose !== -1) {
      html = html.slice(0, bodyClose) + script + html.slice(bodyClose);
    } else {
      html += script;
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
