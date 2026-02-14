/* packages/server/core/typescript/src/procedure.ts */

import type { Schema } from "jtd";

export interface HandleResult {
  status: number;
  body: unknown;
}

export interface InternalProcedure {
  inputSchema: Schema;
  outputSchema: Schema;
  handler: (params: { input: unknown }) => unknown | Promise<unknown>;
}
