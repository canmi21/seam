/* src/server/core/typescript/src/errors.ts */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | (string & {});

export const DEFAULT_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class SeamError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code] ?? 500;
    this.name = "SeamError";
  }

  toJSON() {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        transient: false,
      },
    };
  }
}
