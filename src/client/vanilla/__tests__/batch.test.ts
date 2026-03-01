/* src/client/vanilla/__tests__/batch.test.ts */

import { describe, expect, it, vi } from "vitest";
import { createBatchQueue } from "../src/batch.js";
import type { BatchFetchFn } from "../src/batch.js";

describe("createBatchQueue()", () => {
  it("batches same-tick calls into one batchFetch invocation", async () => {
    const batchFetch = vi.fn<BatchFetchFn>().mockResolvedValue({
      results: [
        { ok: true, data: { user: "a" } },
        { ok: true, data: { user: "b" } },
      ],
    });

    const enqueue = createBatchQueue(batchFetch);

    const p1 = enqueue("getUser", { id: 1 });
    const p2 = enqueue("getUser", { id: 2 });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(batchFetch).toHaveBeenCalledOnce();
    expect(batchFetch).toHaveBeenCalledWith([
      { procedure: "getUser", input: { id: 1 } },
      { procedure: "getUser", input: { id: 2 } },
    ]);
    expect(r1).toEqual({ user: "a" });
    expect(r2).toEqual({ user: "b" });
  });

  it("produces separate batches for different ticks", async () => {
    let callCount = 0;
    const batchFetch = vi.fn<BatchFetchFn>().mockImplementation(async () => {
      callCount++;
      return { results: [{ ok: true, data: callCount }] };
    });

    const enqueue = createBatchQueue(batchFetch);

    const r1 = await enqueue("a", {});
    const r2 = await enqueue("b", {});

    expect(batchFetch).toHaveBeenCalledTimes(2);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
  });

  it("handles mixed success and failure", async () => {
    const batchFetch = vi.fn<BatchFetchFn>().mockResolvedValue({
      results: [
        { ok: true, data: "good" },
        { ok: false, error: { code: "NOT_FOUND", message: "not found" } },
      ],
    });

    const enqueue = createBatchQueue(batchFetch);

    const p1 = enqueue("ok", {});
    const p2 = enqueue("fail", {});

    await expect(p1).resolves.toBe("good");
    await expect(p2).rejects.toMatchObject({
      name: "SeamClientError",
      code: "NOT_FOUND",
      message: "not found",
    });
  });

  it("rejects all callers on transport failure", async () => {
    const batchFetch = vi.fn<BatchFetchFn>().mockRejectedValue(new Error("network down"));

    const enqueue = createBatchQueue(batchFetch);

    const p1 = enqueue("a", {});
    const p2 = enqueue("b", {});

    await expect(p1).rejects.toThrow("network down");
    await expect(p2).rejects.toThrow("network down");
  });
});
