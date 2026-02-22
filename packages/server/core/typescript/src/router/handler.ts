/* packages/server/core/typescript/src/router/handler.ts */

import { SeamError } from "../errors.js";
import type { ErrorCode } from "../errors.js";
import type { HandleResult, InternalProcedure, InternalSubscription } from "../procedure.js";
import { validateInput, formatValidationErrors } from "../validation/index.js";

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
  validateOutput?: boolean,
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
      return { status: STATUS_MAP[error.code], body: error.toJSON() };
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      status: 500,
      body: new SeamError("INTERNAL_ERROR", message).toJSON(),
    };
  }
}

export async function* handleSubscription(
  subscriptions: Map<string, InternalSubscription>,
  name: string,
  rawInput: unknown,
  validateOutput?: boolean,
): AsyncIterable<unknown> {
  const sub = subscriptions.get(name);
  if (!sub) {
    throw new SeamError("NOT_FOUND", `Subscription '${name}' not found`);
  }

  const validation = validateInput(sub.inputSchema, rawInput);
  if (!validation.valid) {
    throw new SeamError("VALIDATION_ERROR", "Input validation failed");
  }

  for await (const value of sub.handler({ input: rawInput })) {
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
