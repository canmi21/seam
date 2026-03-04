/* src/server/core/typescript/__tests__/page-query-params.test.ts */

import { describe, expect, it } from "vitest";
import { handlePageRequest } from "../src/page/handler.js";
import type { LoaderFn } from "../src/page/index.js";
import {
  makeProcedures,
  mockProcedure,
  simplePage,
  extractSeamData,
} from "./page-handler-helpers.js";

/**
 * Simulate what buildLoaderFn produces for query params.
 * This mirrors the runtime behavior of build-loader.ts with from: "query".
 */
function queryLoader(
  procedure: string,
  paramDefs: Record<string, { from: "route" | "query"; type?: "string" | "int" }>,
): LoaderFn {
  return (params, searchParams) => {
    const input: Record<string, unknown> = {};
    for (const [key, mapping] of Object.entries(paramDefs)) {
      const raw = mapping.from === "query" ? (searchParams?.get(key) ?? undefined) : params[key];
      if (raw !== undefined) {
        input[key] = mapping.type === "int" ? Number(raw) : raw;
      }
    }
    return { procedure, input };
  };
}

describe("page query params", () => {
  it("passes query param to loader", async () => {
    const procs = makeProcedures(["getTab", mockProcedure(({ input }) => input)]);
    const page = simplePage("<div>test</div>", {
      data: queryLoader("getTab", { tab: { from: "query" } }),
    });

    const sp = new URLSearchParams("tab=settings");
    const result = await handlePageRequest(page, {}, procs, undefined, sp);
    expect(result.status).toBe(200);
    const data = extractSeamData(result.html);
    expect(data.data).toEqual({ tab: "settings" });
  });

  it("coerces query param with type int", async () => {
    const procs = makeProcedures(["getPage", mockProcedure(({ input }) => input)]);
    const page = simplePage("<div>test</div>", {
      data: queryLoader("getPage", { page: { from: "query", type: "int" } }),
    });

    const sp = new URLSearchParams("page=3");
    const result = await handlePageRequest(page, {}, procs, undefined, sp);
    expect(result.status).toBe(200);
    const data = extractSeamData(result.html);
    expect(data.data).toEqual({ page: 3 });
  });

  it("omits missing query param from input", async () => {
    const procs = makeProcedures(["getData", mockProcedure(({ input }) => input)]);
    const page = simplePage("<div>test</div>", {
      data: queryLoader("getData", { tab: { from: "query" } }),
    });

    const result = await handlePageRequest(page, {}, procs, undefined, undefined);
    expect(result.status).toBe(200);
    const data = extractSeamData(result.html);
    expect(data.data).toEqual({});
  });

  it("mixes route and query params", async () => {
    const procs = makeProcedures(["getDetail", mockProcedure(({ input }) => input)]);
    const page = simplePage("<div>test</div>", {
      data: queryLoader("getDetail", {
        id: { from: "route" },
        tab: { from: "query" },
      }),
    });

    const sp = new URLSearchParams("tab=info");
    const result = await handlePageRequest(page, { id: "42" }, procs, undefined, sp);
    expect(result.status).toBe(200);
    const data = extractSeamData(result.html);
    expect(data.data).toEqual({ id: "42", tab: "info" });
  });

  it("preserves existing route-only loader behavior", async () => {
    const procs = makeProcedures(["getUser", mockProcedure(({ input }) => input)]);
    const page = simplePage("<div>test</div>", {
      data: queryLoader("getUser", { id: { from: "route", type: "int" } }),
    });

    const result = await handlePageRequest(page, { id: "7" }, procs);
    expect(result.status).toBe(200);
    const data = extractSeamData(result.html);
    expect(data.data).toEqual({ id: 7 });
  });
});
