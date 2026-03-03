/* src/client/vanilla/__tests__/stream.test.ts */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client.js";
import { SeamClientError } from "../src/errors.js";
import { parseSseStream } from "../src/sse-parser.js";

// Helper: encode SSE text into a ReadableStream
function sseStream(...events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(e));
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

// Helper: build a mock Response with SSE body
function mockSseResponse(...events: string[]): Response {
  return new Response(sseStream(...events), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

beforeEach(() => {
  vi.stubGlobal("EventSource", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseSseStream()", () => {
  it("parses data events with sequence ids", async () => {
    const stream = sseStream(
      'event: data\nid: 0\ndata: {"n":1}\n\n',
      'event: data\nid: 1\ndata: {"n":2}\n\n',
      "event: complete\ndata: {}\n\n",
    );
    const chunks: unknown[] = [];
    let completed = false;

    await parseSseStream(stream.getReader(), {
      onData: (d) => chunks.push(d),
      onError: () => {},
      onComplete: () => {
        completed = true;
      },
    });

    expect(chunks).toEqual([{ n: 1 }, { n: 2 }]);
    expect(completed).toBe(true);
  });

  it("handles error events", async () => {
    const stream = sseStream(
      'event: error\ndata: {"code":"NOT_FOUND","message":"unknown procedure"}\n\n',
    );
    const errors: Array<{ code: string; message: string }> = [];

    await parseSseStream(stream.getReader(), {
      onData: () => {},
      onError: (e) => errors.push(e),
      onComplete: () => {},
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("NOT_FOUND");
    expect(errors[0].message).toBe("unknown procedure");
  });

  it("handles malformed JSON in data event", async () => {
    const stream = sseStream("event: data\ndata: not-json\n\n");
    const errors: Array<{ code: string; message: string }> = [];

    await parseSseStream(stream.getReader(), {
      onData: () => {},
      onError: (e) => errors.push(e),
      onComplete: () => {},
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("INTERNAL_ERROR");
  });

  it("handles chunked delivery (split across reads)", async () => {
    // Single event split across two chunks
    const encoder = new TextEncoder();
    const part1 = encoder.encode("event: data\nid: 0\n");
    const part2 = encoder.encode('data: {"v":42}\n\n');
    let i = 0;
    const parts = [part1, part2];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < parts.length) {
          controller.enqueue(parts[i++]);
        } else {
          controller.close();
        }
      },
    });

    const chunks: unknown[] = [];
    await parseSseStream(stream.getReader(), {
      onData: (d) => chunks.push(d),
      onError: () => {},
      onComplete: () => {},
    });

    expect(chunks).toEqual([{ v: 42 }]);
  });
});

describe("client.stream()", () => {
  it("sends POST and delivers chunks via subscribe", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockSseResponse(
          'event: data\nid: 0\ndata: {"n":1}\n\n',
          'event: data\nid: 1\ndata: {"n":2}\n\n',
          "event: complete\ndata: {}\n\n",
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient({ baseUrl: "http://localhost:3000" });
    const handle = client.stream("countStream", { max: 5 });

    const chunks: unknown[] = [];
    handle.subscribe((chunk) => chunks.push(chunk));

    // Wait for async fetch + parsing
    await vi.waitFor(() => expect(chunks).toHaveLength(2));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/_seam/procedure/countStream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ max: 5 }),
      }),
    );
    expect(chunks).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("subscribe returns unsubscribe that aborts", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    // fetch that never resolves (simulates long-running stream)
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    const client = createClient({ baseUrl: "http://localhost:3000" });
    const handle = client.stream("slow", {});
    const unsub = handle.subscribe(() => {});

    unsub();
    expect(abortSpy).toHaveBeenCalled();
  });

  it("cancel() aborts the stream", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    const client = createClient({ baseUrl: "http://localhost:3000" });
    const handle = client.stream("slow", {});
    handle.subscribe(() => {});

    handle.cancel();
    expect(abortSpy).toHaveBeenCalled();
  });

  it("reports HTTP errors via onError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    const client = createClient({ baseUrl: "http://localhost:3000" });
    const handle = client.stream("missing", {});
    const errors: SeamClientError[] = [];
    handle.subscribe(
      () => {},
      (err) => errors.push(err),
    );

    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBeInstanceOf(SeamClientError);
    expect(errors[0].status).toBe(404);
  });

  it("reports SSE error events via onError", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockSseResponse(
            'event: error\ndata: {"code":"VALIDATION_ERROR","message":"bad input"}\n\n',
          ),
        ),
    );

    const client = createClient({ baseUrl: "http://localhost:3000" });
    const handle = client.stream("validated", {});
    const errors: SeamClientError[] = [];
    handle.subscribe(
      () => {},
      (err) => errors.push(err),
    );

    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0].code).toBe("VALIDATION_ERROR");
    expect(errors[0].message).toBe("bad input");
  });

  it("ignores AbortError on cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );

    const client = createClient({ baseUrl: "http://localhost:3000" });
    const handle = client.stream("test", {});
    const errors: SeamClientError[] = [];
    handle.subscribe(
      () => {},
      (err) => errors.push(err),
    );

    // Give time for the rejection to propagate
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toHaveLength(0);
  });

  it("reports network errors via onError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));

    const client = createClient({ baseUrl: "http://localhost:3000" });
    const handle = client.stream("test", {});
    const errors: SeamClientError[] = [];
    handle.subscribe(
      () => {},
      (err) => errors.push(err),
    );

    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0].code).toBe("INTERNAL_ERROR");
    expect(errors[0].message).toBe("Network failure");
  });
});
