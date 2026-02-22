/* packages/server/core/typescript/src/validation/index.ts */

import { validate } from "jtd";
import type { Schema, ValidationError as JTDValidationError } from "jtd";

export interface ValidationResult {
  valid: boolean;
  errors: JTDValidationError[];
}

export function validateInput(schema: Schema, data: unknown): ValidationResult {
  const errors = validate(schema, data, { maxDepth: 32, maxErrors: 10 });
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function formatValidationErrors(errors: JTDValidationError[]): string {
  return errors
    .map((e) => {
      const path = e.instancePath.length > 0 ? e.instancePath.join("/") : "(root)";
      const schema = e.schemaPath.join("/");
      return `${path} (schema: ${schema})`;
    })
    .join("; ");
}
