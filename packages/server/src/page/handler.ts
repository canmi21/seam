/* packages/server/src/page/handler.ts */

import { inject, escapeHtml } from "@canmi/seam-injector";
import { SeamError } from "../errors.js";
import type { InternalProcedure } from "../procedure.js";
import type { PageDef } from "./index.js";

export interface HandlePageResult {
  status: number;
  html: string;
}

export async function handlePageRequest(
  page: PageDef,
  params: Record<string, string>,
  procedures: Map<string, InternalProcedure>,
): Promise<HandlePageResult> {
  try {
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

    const html = inject(page.template, Object.fromEntries(results));
    return { status: 200, html };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      status: 500,
      html: `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>${escapeHtml(message)}</p></body></html>`,
    };
  }
}
