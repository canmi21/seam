/* src/client/vanilla/__tests__/subscribe.test.ts */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client.js";
import { SeamClientError } from "../src/errors.js";

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

  /** Simulate the browser dispatching an event */
  emit(event: string, data?: unknown) {
    for (const cb of this.listeners.get(event) ?? []) {
      cb(data);
    }
  }
}

let lastEs: MockEventSource;

beforeEach(() => {
  // vitest 4 requires `function` keyword (not arrow) for constructor mocks
  vi.stubGlobal(
    "EventSource",
    vi.fn(function (url: string) {
      lastEs = new MockEventSource(url);
      return lastEs;
    }),
  );
  // stub fetch so createClient doesn't fail on other methods
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("subscribe()", () => {
  it("creates EventSource with correct URL and input params", () => {
    const client = createClient({ baseUrl: "http://localhost:3000" });
    client.subscribe("counter", { room: "A" }, vi.fn());

    expect(EventSource).toHaveBeenCalledWith(
      "http://localhost:3000/_seam/procedure/counter?input=%7B%22room%22%3A%22A%22%7D",
    );
  });

  it("calls onData with parsed JSON on data event", () => {
    const client = createClient({ baseUrl: "http://localhost:3000" });
    const onData = vi.fn();
    client.subscribe("counter", {}, onData);

    lastEs.emit("data", { data: JSON.stringify({ count: 42 }) });

    expect(onData).toHaveBeenCalledWith({ count: 42 });
  });

  it("calls onError on MessageEvent error with parseable payload", () => {
    const client = createClient({ baseUrl: "http://localhost:3000" });
    const onError = vi.fn();
    client.subscribe("counter", {}, vi.fn(), onError);

    // Simulate a MessageEvent-like error (has data property)
    const errorEvent = new MessageEvent("error", {
      data: JSON.stringify({ code: "NOT_FOUND", message: "stream not found" }),
    });
    lastEs.emit("error", errorEvent);

    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0] as SeamClientError;
    expect(err).toBeInstanceOf(SeamClientError);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("stream not found");
    expect(lastEs.close).toHaveBeenCalled();
  });

  it("calls onError with INTERNAL_ERROR on non-MessageEvent error", () => {
    const client = createClient({ baseUrl: "http://localhost:3000" });
    const onError = vi.fn();
    client.subscribe("counter", {}, vi.fn(), onError);

    // Plain Event (not MessageEvent) — e.g. network disconnect
    lastEs.emit("error", new Event("error"));

    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0] as SeamClientError;
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toBe("SSE connection error");
    expect(lastEs.close).toHaveBeenCalled();
  });

  it("closes EventSource on complete event", () => {
    const client = createClient({ baseUrl: "http://localhost:3000" });
    client.subscribe("counter", {}, vi.fn());

    lastEs.emit("complete");

    expect(lastEs.close).toHaveBeenCalled();
  });

  it("returned unsubscribe closes EventSource", () => {
    const client = createClient({ baseUrl: "http://localhost:3000" });
    const unsub = client.subscribe("counter", {}, vi.fn());

    unsub();

    expect(lastEs.close).toHaveBeenCalled();
  });

  it("calls onError with INTERNAL_ERROR when data parse fails", () => {
    const client = createClient({ baseUrl: "http://localhost:3000" });
    const onError = vi.fn();
    client.subscribe("counter", {}, vi.fn(), onError);

    lastEs.emit("data", { data: "not valid json{" });

    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0] as SeamClientError;
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toBe("Failed to parse SSE data");
  });
});
