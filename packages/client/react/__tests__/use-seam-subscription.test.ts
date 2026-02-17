/* packages/client/react/__tests__/use-seam-subscription.test.ts */
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSeamSubscription } from "../src/index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- MockEventSource (same pattern as @canmi/seam-client tests) ---

type Listener = (e: unknown) => void;

class MockEventSource {
  url: string;
  private listeners = new Map<string, Listener[]>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(event: string, cb: Listener) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  emit(event: string, data?: unknown) {
    for (const cb of this.listeners.get(event) ?? []) {
      cb(data);
    }
  }
}

// --- Test harness ---

let lastEs: MockEventSource;
let container: HTMLDivElement;
let root: Root;

function readState() {
  const el = container.querySelector("#result");
  return JSON.parse(el!.textContent!);
}

// Test component that renders hook state as JSON
function Sub(props: { baseUrl: string; procedure: string; input: unknown }) {
  const { data, error, status } = useSeamSubscription(props.baseUrl, props.procedure, props.input);
  return createElement(
    "pre",
    { id: "result" },
    JSON.stringify({
      data,
      error: error ? { code: error.code, message: error.message } : null,
      status,
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "EventSource",
    vi.fn().mockImplementation((url: string) => {
      lastEs = new MockEventSource(url);
      return lastEs;
    }),
  );
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

describe("useSeamSubscription: connection", () => {
  it("creates EventSource with correct URL", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, {
          baseUrl: "http://localhost:3000/",
          procedure: "counter",
          input: { room: "A" },
        }),
      );
    });

    expect(EventSource).toHaveBeenCalledWith(expect.stringContaining("/_seam/subscribe/counter?"));
    // Verify trailing slash normalization and input encoding
    const url = (EventSource as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url.startsWith("http://localhost:3000/_seam/")).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(JSON.parse(params.get("input")!)).toEqual({ room: "A" });
  });

  it("starts in connecting state with null data and error", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, { baseUrl: "http://localhost:3000", procedure: "counter", input: {} }),
      );
    });

    expect(readState()).toEqual({ data: null, error: null, status: "connecting" });
  });

  it("transitions to active on data event", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, { baseUrl: "http://localhost:3000", procedure: "counter", input: {} }),
      );
    });

    await act(async () => {
      lastEs.emit("data", { data: JSON.stringify({ count: 42 }) });
    });

    expect(readState()).toEqual({ data: { count: 42 }, error: null, status: "active" });
  });
});

describe("useSeamSubscription: errors", () => {
  it("transitions to error on data parse failure and closes EventSource", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, { baseUrl: "http://localhost:3000", procedure: "counter", input: {} }),
      );
    });

    await act(async () => {
      lastEs.emit("data", { data: "not valid json{" });
    });

    const state = readState();
    expect(state.status).toBe("error");
    expect(state.error.code).toBe("INTERNAL_ERROR");
    expect(state.error.message).toBe("Failed to parse SSE data");
    expect(lastEs.close).toHaveBeenCalled();
  });

  it("transitions to error on MessageEvent error with parseable payload", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, { baseUrl: "http://localhost:3000", procedure: "counter", input: {} }),
      );
    });

    await act(async () => {
      const errorEvent = new MessageEvent("error", {
        data: JSON.stringify({ code: "NOT_FOUND", message: "stream not found" }),
      });
      lastEs.emit("error", errorEvent);
    });

    const state = readState();
    expect(state.status).toBe("error");
    expect(state.error.message).toBe("stream not found");
    expect(lastEs.close).toHaveBeenCalled();
  });

  it("transitions to error on MessageEvent with unparseable payload", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, { baseUrl: "http://localhost:3000", procedure: "counter", input: {} }),
      );
    });

    await act(async () => {
      const errorEvent = new MessageEvent("error", { data: "bad json{" });
      lastEs.emit("error", errorEvent);
    });

    const state = readState();
    expect(state.status).toBe("error");
    expect(state.error.message).toBe("SSE error");
    expect(lastEs.close).toHaveBeenCalled();
  });

  it("transitions to error on plain Event (connection error)", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, { baseUrl: "http://localhost:3000", procedure: "counter", input: {} }),
      );
    });

    await act(async () => {
      lastEs.emit("error", new Event("error"));
    });

    const state = readState();
    expect(state.status).toBe("error");
    expect(state.error.code).toBe("INTERNAL_ERROR");
    expect(state.error.message).toBe("SSE connection error");
    expect(lastEs.close).toHaveBeenCalled();
  });
});

describe("useSeamSubscription: lifecycle", () => {
  it("transitions to closed on complete event", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, { baseUrl: "http://localhost:3000", procedure: "counter", input: {} }),
      );
    });

    await act(async () => {
      lastEs.emit("complete");
    });

    expect(readState().status).toBe("closed");
    expect(lastEs.close).toHaveBeenCalled();
  });

  it("closes EventSource on unmount", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, { baseUrl: "http://localhost:3000", procedure: "counter", input: {} }),
      );
    });

    const es = lastEs;

    await act(async () => {
      root.render(createElement("div"));
    });

    expect(es.close).toHaveBeenCalled();
  });

  it("resets state and creates new EventSource when inputs change", async () => {
    await act(async () => {
      root.render(
        createElement(Sub, {
          baseUrl: "http://localhost:3000",
          procedure: "counter",
          input: { room: "A" },
        }),
      );
    });

    const firstEs = lastEs;

    // Receive data on first connection
    await act(async () => {
      firstEs.emit("data", { data: JSON.stringify({ count: 1 }) });
    });
    expect(readState().status).toBe("active");

    // Change input -> should create new EventSource and reset state
    await act(async () => {
      root.render(
        createElement(Sub, {
          baseUrl: "http://localhost:3000",
          procedure: "counter",
          input: { room: "B" },
        }),
      );
    });

    expect(firstEs.close).toHaveBeenCalled();
    expect(lastEs).not.toBe(firstEs);
    expect(readState()).toEqual({ data: null, error: null, status: "connecting" });
  });
});
