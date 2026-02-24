/* packages/client/vanilla/src/rpc.ts */

import { createClient } from "./client.js";
import type { SeamClient } from "./client.js";
import { createBatchQueue } from "./batch.js";

let rpcHashMap: Record<string, string> | null = null;
let configuredBatchEndpoint: string | null = null;

let browserClient: SeamClient | null = null;

function getBrowserClient(): SeamClient {
  if (!browserClient) {
    browserClient = createClient({
      baseUrl: "",
      batchEndpoint: configuredBatchEndpoint ?? undefined,
    });
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

/** Configure the RPC hash map for obfuscated endpoints. */
export function configureRpcMap(map: Record<string, string>): void {
  rpcHashMap = { ...map };
  configuredBatchEndpoint = map["_batch"] ?? null;
  // Reset singletons so next call picks up new config
  browserClient = null;
  batchEnqueue = null;
}

export function seamRpc(procedure: string, input?: unknown): Promise<unknown> {
  const wireName = rpcHashMap?.[procedure] ?? procedure;
  return getBatchEnqueue()(wireName, input ?? {});
}
