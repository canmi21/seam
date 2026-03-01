/* src/server/core/typescript/__tests__/subscription.test.ts */

import { describe, expect, it } from "vitest";
import {
  createRouter,
  t,
  createHttpHandler,
  sseDataEvent,
  sseErrorEvent,
  sseCompleteEvent,
  fromCallback,
} from "../src/index.js";
import type { SubscriptionDef, HttpStreamResponse } from "../src/index.js";

// -- SSE formatting --

describe("SSE formatting", () => {
  it("sseDataEvent formats correctly", () => {
    expect(sseDataEvent({ n: 1 })).toBe('event: data\ndata: {"n":1}\n\n');
  });

  it("sseErrorEvent formats correctly", () => {
    expect(sseErrorEvent("NOT_FOUND", "not found")).toBe(
      'event: error\ndata: {"code":"NOT_FOUND","message":"not found","transient":false}\n\n',
    );
  });

  it("sseCompleteEvent formats correctly", () => {
    expect(sseCompleteEvent()).toBe("event: complete\ndata: {}\n\n");
  });
});

// -- Subscription handler --

async function* countStream(max: number): AsyncGenerator<{ n: number }> {
  for (let i = 1; i <= max; i++) {
    yield { n: i };
  }
}

const router = createRouter({
  greet: {
    input: t.object({ name: t.string() }),
    output: t.object({ message: t.string() }),
    handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  },
  onCount: {
    type: "subscription",
    input: t.object({ max: t.int32() }),
    output: t.object({ n: t.int32() }),
    handler: ({ input }) => countStream(input.max),
  } satisfies SubscriptionDef<{ max: number }, { n: number }>,
});

describe("router.handleSubscription", () => {
  it("yields values from the subscription handler", async () => {
    const results: unknown[] = [];
    for await (const value of router.handleSubscription("onCount", { max: 3 })) {
      results.push(value);
    }
    expect(results).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("throws NOT_FOUND for unknown subscription", async () => {
    const iter = router.handleSubscription("unknown", {});
    await expect(collect(iter)).rejects.toThrow("not found");
  });

  it("throws VALIDATION_ERROR for invalid input", async () => {
    const iter = router.handleSubscription("onCount", { max: "not a number" });
    await expect(collect(iter)).rejects.toThrow("Input validation failed:");
  });
});

describe("subscription output validation", () => {
  it("emits SSE error when subscription yields invalid output", async () => {
    const validatedRouter = createRouter(
      {
        badSub: {
          type: "subscription",
          input: t.object({}),
          output: t.object({ n: t.int32() }),
          handler: async function* () {
            yield { wrong: "field" };
          },
        } satisfies SubscriptionDef<Record<string, never>, { n: number }>,
      },
      { validateOutput: true },
    );
    const handler = createHttpHandler(validatedRouter);
    const res = await handler({
      method: "GET",
      url: "http://localhost/_seam/procedure/badSub",
      body: () => Promise.reject(new Error("no body")),
    });
    expect("stream" in res).toBe(true);
    const chunks = await collectStrings((res as HttpStreamResponse).stream);
    expect(chunks[0]).toContain("INTERNAL_ERROR");
    expect(chunks[0]).toContain("Output validation failed");
  });
});

// -- Manifest type field --

describe("manifest type field", () => {
  it("includes type for all procedures", () => {
    const manifest = router.manifest();
    expect(manifest.procedures.greet.type).toBe("query");
    expect(manifest.procedures.onCount.type).toBe("subscription");
  });
});

// -- SSE HTTP endpoint --

describe("SSE HTTP endpoint", () => {
  const handler = createHttpHandler(router);

  function sseReq(url: string) {
    return handler({
      method: "GET",
      url: `http://localhost${url}`,
      body: () => Promise.reject(new Error("no body")),
    });
  }

  it("returns SSE stream for subscription", async () => {
    const res = await sseReq("/_seam/procedure/onCount?input=%7B%22max%22%3A2%7D");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect("stream" in res).toBe(true);

    const chunks = await collectStrings((res as HttpStreamResponse).stream);
    expect(chunks).toContain('event: data\ndata: {"n":1}\n\n');
    expect(chunks).toContain('event: data\ndata: {"n":2}\n\n');
    expect(chunks[chunks.length - 1]).toBe("event: complete\ndata: {}\n\n");
  });

  it("returns 404 for unknown subscription", async () => {
    const res = await sseReq("/_seam/procedure/unknown");
    expect("stream" in res).toBe(true);

    const chunks = await collectStrings((res as HttpStreamResponse).stream);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("NOT_FOUND");
  });

  it("returns 404 for empty subscription name", async () => {
    const res = await sseReq("/_seam/procedure/");
    expect(res.status).toBe(404);
    expect("body" in res).toBe(true);
  });

  it("returns 400 for invalid input query", async () => {
    const res = await sseReq("/_seam/procedure/onCount?input=not-json");
    expect(res.status).toBe(400);
    expect("body" in res).toBe(true);
  });

  it("defaults input to {} when no query param", async () => {
    // onCount expects { max: int32 }, so this should fail validation as an SSE error
    const res = await sseReq("/_seam/procedure/onCount");
    expect("stream" in res).toBe(true);

    const chunks = await collectStrings((res as HttpStreamResponse).stream);
    expect(chunks[0]).toContain("VALIDATION_ERROR");
  });
});

// -- fromCallback --

describe("fromCallback", () => {
  it("yields emitted values", async () => {
    const gen = fromCallback<number>(({ emit, end }) => {
      emit(1);
      emit(2);
      emit(3);
      end();
    });

    const results = await collect(gen);
    expect(results).toEqual([1, 2, 3]);
  });

  it("stops on end()", async () => {
    const gen = fromCallback<number>(({ emit, end }) => {
      emit(1);
      end();
      emit(2); // should be ignored
    });

    const results = await collect(gen);
    expect(results).toEqual([1]);
  });

  it("throws on error()", async () => {
    const gen = fromCallback<number>(({ emit, error }) => {
      emit(1);
      error(new Error("test error"));
    });

    const results: number[] = [];
    await expect(
      (async () => {
        for await (const v of gen) results.push(v);
      })(),
    ).rejects.toThrow("test error");
    expect(results).toEqual([1]);
  });

  it("calls cleanup on return", async () => {
    let cleaned = false;
    const gen = fromCallback<number>(({ emit, end }) => {
      emit(1);
      end();
      return () => {
        cleaned = true;
      };
    });

    await collect(gen);
    expect(cleaned).toBe(true);
  });

  it("handles async emit via setTimeout", async () => {
    const gen = fromCallback<number>(({ emit, end }) => {
      setTimeout(() => {
        emit(1);
        emit(2);
        end();
      }, 10);
    });

    const results = await collect(gen);
    expect(results).toEqual([1, 2]);
  });
});

// -- helpers --

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const v of iter) results.push(v);
  return results;
}

async function collectStrings(iter: AsyncIterable<string>): Promise<string[]> {
  return collect(iter);
}
