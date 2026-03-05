/* src/client/vanilla/src/__tests__/prefetch-cache.test.ts */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { getFromCache, storePending, clearPrefetchCache } from "../prefetch-cache.js";

beforeEach(() => {
  clearPrefetchCache();
});

describe("prefetch cache", () => {
  test("returns undefined for uncached procedure", () => {
    expect(getFromCache("getUser", {})).toBeUndefined();
  });

  test("stores and retrieves resolved data", async () => {
    const promise = Promise.resolve({ name: "Alice" });
    storePending("getUser", { id: "1" }, promise, 60);

    // Pending cache hit
    const cached = getFromCache("getUser", { id: "1" });
    expect(cached).toBeDefined();
    expect(await cached).toEqual({ name: "Alice" });

    // After resolve, data cache hit
    await promise;
    const fromData = getFromCache("getUser", { id: "1" });
    expect(fromData).toBeDefined();
    expect(await fromData).toEqual({ name: "Alice" });
  });

  test("TTL expiry returns undefined", async () => {
    vi.useFakeTimers();
    const promise = Promise.resolve({ name: "Bob" });
    storePending("getUser", {}, promise, 5);
    await promise;
    // Flush microtasks so .then() in storePending runs
    await vi.advanceTimersByTimeAsync(0);

    // Within TTL
    expect(getFromCache("getUser", {})).toBeDefined();

    // Advance past TTL
    vi.advanceTimersByTime(6000);
    expect(getFromCache("getUser", {})).toBeUndefined();
    vi.useRealTimers();
  });

  test("pending promise dedup", () => {
    const promise = new Promise(() => {});
    storePending("getUser", { id: "1" }, promise, 30);
    const hit = getFromCache("getUser", { id: "1" });
    expect(hit).toBeDefined();
    // Same reference from pending cache
    expect(hit).not.toBe(promise); // wrapped promise
  });

  test("clearPrefetchCache resets all", async () => {
    const promise = Promise.resolve({ ok: true });
    storePending("check", {}, promise, 60);
    // Await the wrapped promise to flush .then() handler
    await getFromCache("check", {});

    expect(getFromCache("check", {})).toBeDefined();
    clearPrefetchCache();
    expect(getFromCache("check", {})).toBeUndefined();
  });

  test("different inputs produce different cache keys", async () => {
    const p1 = Promise.resolve({ name: "A" });
    const p2 = Promise.resolve({ name: "B" });
    storePending("getUser", { id: "1" }, p1, 60);
    storePending("getUser", { id: "2" }, p2, 60);

    expect(await getFromCache("getUser", { id: "1" })).toEqual({ name: "A" });
    expect(await getFromCache("getUser", { id: "2" })).toEqual({ name: "B" });
  });
});
