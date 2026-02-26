/* packages/server/core/typescript/src/procedure.ts */

import type { Schema } from "jtd";

export interface HandleResult {
  status: number;
  body: unknown;
}

export interface ProcedureCtx {
  locale?: string;
}

export interface InternalProcedure {
  inputSchema: Schema;
  outputSchema: Schema;
  handler: (params: { input: unknown; ctx?: ProcedureCtx }) => unknown;
}

export interface InternalSubscription {
  inputSchema: Schema;
  outputSchema: Schema;
  handler: (params: { input: unknown; ctx?: ProcedureCtx }) => AsyncIterable<unknown>;
}
