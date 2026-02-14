/* packages/server/core/typescript/src/router/handler.ts */

import { SeamError } from "../errors.js";
import type { ErrorCode } from "../errors.js";
import type { HandleResult, InternalProcedure } from "../procedure.js";
import { validateInput } from "../validation/index.js";

export type { HandleResult, InternalProcedure } from "../procedure.js";

const STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export async function handleRequest(
  procedures: Map<string, InternalProcedure>,
  procedureName: string,
  rawBody: unknown,
): Promise<HandleResult> {
  const procedure = procedures.get(procedureName);
  if (!procedure) {
    return {
      status: 404,
      body: new SeamError("NOT_FOUND", `Procedure '${procedureName}' not found`).toJSON(),
    };
  }

  const validation = validateInput(procedure.inputSchema, rawBody);
  if (!validation.valid) {
    return {
      status: 400,
      body: new SeamError("VALIDATION_ERROR", "Input validation failed").toJSON(),
    };
  }

  try {
    const result = await procedure.handler({ input: rawBody });
    return { status: 200, body: result };
  } catch (error) {
    if (error instanceof SeamError) {
      return { status: STATUS_MAP[error.code], body: error.toJSON() };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      status: 500,
      body: new SeamError("INTERNAL_ERROR", message).toJSON(),
    };
  }
}
