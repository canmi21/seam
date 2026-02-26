/* packages/server/core/typescript/src/router/handler.ts */

import { SeamError } from "../errors.js";
import type {
  HandleResult,
  InternalProcedure,
  InternalSubscription,
  ProcedureCtx,
} from "../procedure.js";
import { validateInput, formatValidationErrors } from "../validation/index.js";

export type { HandleResult, InternalProcedure, ProcedureCtx } from "../procedure.js";

export async function handleRequest(
  procedures: Map<string, InternalProcedure>,
  procedureName: string,
  rawBody: unknown,
  validateOutput?: boolean,
  ctx?: ProcedureCtx,
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
    const details = formatValidationErrors(validation.errors);
    return {
      status: 400,
      body: new SeamError("VALIDATION_ERROR", `Input validation failed: ${details}`).toJSON(),
    };
  }

  try {
    const result = await procedure.handler({ input: rawBody, ctx });

    if (validateOutput) {
      const outValidation = validateInput(procedure.outputSchema, result);
      if (!outValidation.valid) {
        const details = formatValidationErrors(outValidation.errors);
        return {
          status: 500,
          body: new SeamError("INTERNAL_ERROR", `Output validation failed: ${details}`).toJSON(),
        };
      }
    }

    return { status: 200, body: result };
  } catch (error) {
    if (error instanceof SeamError) {
      return { status: error.status, body: error.toJSON() };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      status: 500,
      body: new SeamError("INTERNAL_ERROR", message).toJSON(),
    };
  }
}

export interface BatchCall {
  procedure: string;
  input: unknown;
}

export type BatchResultItem =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };

export async function handleBatchRequest(
  procedures: Map<string, InternalProcedure>,
  calls: BatchCall[],
  validateOutput?: boolean,
  ctx?: ProcedureCtx,
): Promise<{ results: BatchResultItem[] }> {
  const results = await Promise.all(
    calls.map(async (call) => {
      const result = await handleRequest(
        procedures,
        call.procedure,
        call.input,
        validateOutput,
        ctx,
      );
      if (result.status === 200) {
        return { ok: true as const, data: result.body };
      }
      const envelope = result.body as { error: { code: string; message: string } };
      return { ok: false as const, error: envelope.error };
    }),
  );
  return { results };
}

export async function* handleSubscription(
  subscriptions: Map<string, InternalSubscription>,
  name: string,
  rawInput: unknown,
  validateOutput?: boolean,
  ctx?: ProcedureCtx,
): AsyncIterable<unknown> {
  const sub = subscriptions.get(name);
  if (!sub) {
    throw new SeamError("NOT_FOUND", `Subscription '${name}' not found`);
  }

  const validation = validateInput(sub.inputSchema, rawInput);
  if (!validation.valid) {
    const details = formatValidationErrors(validation.errors);
    throw new SeamError("VALIDATION_ERROR", `Input validation failed: ${details}`);
  }

  for await (const value of sub.handler({ input: rawInput, ctx })) {
    if (validateOutput) {
      const outValidation = validateInput(sub.outputSchema, value);
      if (!outValidation.valid) {
        const details = formatValidationErrors(outValidation.errors);
        throw new SeamError("INTERNAL_ERROR", `Output validation failed: ${details}`);
      }
    }
    yield value;
  }
}
