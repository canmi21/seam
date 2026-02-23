/* packages/client/vanilla/src/rpc.ts */

import { createClient } from "./client.js";
import type { SeamClient } from "./client.js";
import { createBatchQueue } from "./batch.js";

let browserClient: SeamClient | null = null;

function getBrowserClient(): SeamClient {
  if (!browserClient) {
    browserClient = createClient({ baseUrl: "" });
  }
  return browserClient;
}

let batchEnqueue: ((proc: string, input: unknown) => Promise<unknown>) | null = null;

function getBatchEnqueue() {
  if (!batchEnqueue) {
    const client = getBrowserClient();
    batchEnqueue = createBatchQueue((calls) => client.callBatch(calls));
  }
  return batchEnqueue;
}

export function seamRpc(procedure: string, input?: unknown): Promise<unknown> {
  return getBatchEnqueue()(procedure, input ?? {});
}
