/* src/client/react/__tests__/use-seam-stream.test.ts */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSeamStream } from "../src/index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function mockSseResponse(...events: string[]): Response {
  return new Response(sseStream(...events), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// --- Test harness ---

let container: HTMLDivElement;
let root: Root;

function readState() {
  const el = container.querySelector("#result");
  return JSON.parse(el!.textContent!);
}

function StreamComp(props: { baseUrl: string; procedure: string; input: unknown }) {
  const { chunks, latestChunk, status, error } = useSeamStream(
    props.baseUrl,
    props.procedure,
    props.input,
  );
  return createElement(
    "pre",
    { id: "result" },
    JSON.stringify({
      chunks,
      latestChunk,
      status,
      error: error ? { code: error.code, message: error.message } : null,
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("EventSource", vi.fn());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("useSeamStream: streaming", () => {
  it("starts in streaming state and accumulates chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockSseResponse(
            'event: data\nid: 0\ndata: {"n":1}\n\n',
            'event: data\nid: 1\ndata: {"n":2}\n\n',
            "event: complete\ndata: {}\n\n",
          ),
        ),
    );

    await act(async () => {
      root.render(
        createElement(StreamComp, {
          baseUrl: "http://localhost:3000",
          procedure: "countStream",
          input: { max: 5 },
        }),
      );
    });

    // Wait for stream to complete
    await act(async () => {
      await vi.waitFor(() => {
        const state = readState();
        expect(state.status).toBe("completed");
      });
    });

    const state = readState();
    expect(state.chunks).toEqual([{ n: 1 }, { n: 2 }]);
    expect(state.latestChunk).toEqual({ n: 2 });
    expect(state.error).toBeNull();
  });

  it("sends POST with correct URL and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSseResponse("event: complete\ndata: {}\n\n"));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(StreamComp, {
          baseUrl: "http://localhost:3000/",
          procedure: "countStream",
          input: { max: 5 },
        }),
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/_seam/procedure/countStream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ max: 5 }),
      }),
    );
  });
});

describe("useSeamStream: errors", () => {
  it("transitions to error on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await act(async () => {
      root.render(
        createElement(StreamComp, {
          baseUrl: "http://localhost:3000",
          procedure: "failing",
          input: {},
        }),
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(readState().status).toBe("error");
      });
    });

    const state = readState();
    expect(state.error.code).toBe("INTERNAL_ERROR");
    expect(state.error.message).toBe("HTTP 500");
  });

  it("transitions to error on SSE error event", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockSseResponse('event: error\ndata: {"code":"VALIDATION_ERROR","message":"bad"}\n\n'),
        ),
    );

    await act(async () => {
      root.render(
        createElement(StreamComp, {
          baseUrl: "http://localhost:3000",
          procedure: "validated",
          input: {},
        }),
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(readState().status).toBe("error");
      });
    });

    const state = readState();
    expect(state.error.code).toBe("VALIDATION_ERROR");
    expect(state.error.message).toBe("bad");
  });

  it("transitions to error on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));

    await act(async () => {
      root.render(
        createElement(StreamComp, {
          baseUrl: "http://localhost:3000",
          procedure: "test",
          input: {},
        }),
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(readState().status).toBe("error");
      });
    });

    expect(readState().error.message).toBe("Network down");
  });
});

describe("useSeamStream: lifecycle", () => {
  it("aborts fetch on unmount", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    await act(async () => {
      root.render(
        createElement(StreamComp, {
          baseUrl: "http://localhost:3000",
          procedure: "slow",
          input: {},
        }),
      );
    });

    await act(async () => {
      root.render(createElement("div"));
    });

    expect(abortSpy).toHaveBeenCalled();
  });

  it("resets state when input changes", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            mockSseResponse(
              'event: data\nid: 0\ndata: {"n":1}\n\n',
              "event: complete\ndata: {}\n\n",
            ),
          );
        }
        return Promise.resolve(mockSseResponse("event: complete\ndata: {}\n\n"));
      }),
    );

    await act(async () => {
      root.render(
        createElement(StreamComp, {
          baseUrl: "http://localhost:3000",
          procedure: "counter",
          input: { v: 1 },
        }),
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(readState().status).toBe("completed");
      });
    });

    expect(readState().chunks).toEqual([{ n: 1 }]);

    // Change input -> should reset
    await act(async () => {
      root.render(
        createElement(StreamComp, {
          baseUrl: "http://localhost:3000",
          procedure: "counter",
          input: { v: 2 },
        }),
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        const state = readState();
        expect(state.status).toBe("completed");
        expect(state.chunks).toEqual([]);
      });
    });
  });
});
