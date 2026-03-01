/* src/client/vanilla/src/batch.ts */

import { SeamClientError } from "./errors.js";

export type BatchFetchFn = (calls: Array<{ procedure: string; input: unknown }>) => Promise<{
  results: Array<
    { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } }
  >;
}>;

interface PendingCall {
  procedure: string;
  input: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export function createBatchQueue(batchFetch: BatchFetchFn) {
  let queue: PendingCall[] = [];
  let scheduled = false;

  function flush() {
    const batch = queue;
    queue = [];
    scheduled = false;

    const calls = batch.map((c) => ({
      procedure: c.procedure,
      input: c.input,
    }));
    batchFetch(calls).then(
      ({ results }) => {
        for (let i = 0; i < batch.length; i++) {
          const item = results[i];
          if (item.ok) {
            batch[i].resolve(item.data);
          } else {
            batch[i].reject(new SeamClientError(item.error.code, item.error.message, 0));
          }
        }
      },
      (err) => {
        for (const pending of batch) {
          pending.reject(err);
        }
      },
    );
  }

  return (procedure: string, input: unknown): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      queue.push({ procedure, input, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
  };
}
