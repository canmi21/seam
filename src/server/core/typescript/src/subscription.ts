/* src/server/core/typescript/src/subscription.ts */

/**
 * Bridge callback-style event sources to an AsyncGenerator.
 *
 * Usage:
 *   const stream = fromCallback<string>(({ emit, end, error }) => {
 *     emitter.on("data", emit);
 *     emitter.on("end", end);
 *     emitter.on("error", error);
 *     return () => emitter.removeAllListeners();
 *   });
 */
export interface CallbackSink<T> {
  emit: (value: T) => void;
  end: () => void;
  error: (err: Error) => void;
}

type QueueItem<T> = { type: "value"; value: T } | { type: "end" } | { type: "error"; error: Error };

export function fromCallback<T>(
  setup: (sink: CallbackSink<T>) => (() => void) | void,
): AsyncGenerator<T, void, undefined> {
  const queue: QueueItem<T>[] = [];
  let resolve: (() => void) | null = null;
  let done = false;
  function notify() {
    if (resolve) {
      const r = resolve;
      resolve = null;
      r();
    }
  }

  const sink: CallbackSink<T> = {
    emit(value) {
      if (done) return;
      queue.push({ type: "value", value });
      notify();
    },
    end() {
      if (done) return;
      done = true;
      queue.push({ type: "end" });
      notify();
    },
    error(err) {
      if (done) return;
      done = true;
      queue.push({ type: "error", error: err });
      notify();
    },
  };

  const cleanup = setup(sink);

  async function* generate(): AsyncGenerator<T, void, undefined> {
    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolve = r;
          });
        }

        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.type === "value") {
            yield item.value;
          } else if (item.type === "error") {
            throw item.error;
          } else {
            return;
          }
        }
      }
    } finally {
      done = true;
      if (cleanup) cleanup();
    }
  }

  return generate();
}
