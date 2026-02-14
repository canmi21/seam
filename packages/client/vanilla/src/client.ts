/* packages/client/vanilla/src/client.ts */

import { SeamClientError } from "./errors.js";
import type { ErrorCode } from "./errors.js";

export interface ClientOptions {
  baseUrl: string;
}

export interface SeamClient {
  call(procedureName: string, input: unknown): Promise<unknown>;
  fetchManifest(): Promise<unknown>;
}

const KNOWN_CODES = new Set<string>(["VALIDATION_ERROR", "NOT_FOUND", "INTERNAL_ERROR"]);

function isKnownCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && KNOWN_CODES.has(code);
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = init ? await fetch(url, init) : await fetch(url);
  } catch {
    throw new SeamClientError("INTERNAL_ERROR", "Network request failed", 0);
  }

  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new SeamClientError("INTERNAL_ERROR", `HTTP ${res.status}`, res.status);
    }

    const err = (parsed as any)?.error;
    const code = isKnownCode(err?.code) ? err.code : "INTERNAL_ERROR";
    const message = typeof err?.message === "string" ? err.message : `HTTP ${res.status}`;
    throw new SeamClientError(code, message, res.status);
  }

  return res.json();
}

export function createClient(opts: ClientOptions): SeamClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");

  return {
    call(procedureName, input) {
      return request(`${baseUrl}/_seam/rpc/${procedureName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },

    fetchManifest() {
      return request(`${baseUrl}/_seam/manifest.json`);
    },
  };
}
