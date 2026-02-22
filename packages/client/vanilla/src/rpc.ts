/* packages/client/vanilla/src/rpc.ts */

import { createClient } from "./client.js";
import type { SeamClient } from "./client.js";

let browserClient: SeamClient | null = null;

function getBrowserClient(): SeamClient {
  if (!browserClient) {
    // Relative URLs work in-browser — all fetches go to /_seam/rpc/...
    browserClient = createClient({ baseUrl: "" });
  }
  return browserClient;
}

export function seamRpc(procedure: string, input?: unknown): Promise<unknown> {
  return getBrowserClient().call(procedure, input ?? {});
}
