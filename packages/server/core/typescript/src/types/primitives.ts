/* packages/server/core/typescript/src/types/primitives.ts */

import type { SchemaNode } from "./schema.js";
import { createSchemaNode } from "./schema.js";

export function string(): SchemaNode<string> {
  return createSchemaNode<string>({ type: "string" });
}

export function boolean(): SchemaNode<boolean> {
  return createSchemaNode<boolean>({ type: "boolean" });
}

export function int8(): SchemaNode<number> {
  return createSchemaNode<number>({ type: "int8" });
}

export function int16(): SchemaNode<number> {
  return createSchemaNode<number>({ type: "int16" });
}

export function int32(): SchemaNode<number> {
  return createSchemaNode<number>({ type: "int32" });
}

export function uint8(): SchemaNode<number> {
  return createSchemaNode<number>({ type: "uint8" });
}

export function uint16(): SchemaNode<number> {
  return createSchemaNode<number>({ type: "uint16" });
}

export function uint32(): SchemaNode<number> {
  return createSchemaNode<number>({ type: "uint32" });
}

export function float32(): SchemaNode<number> {
  return createSchemaNode<number>({ type: "float32" });
}

export function float64(): SchemaNode<number> {
  return createSchemaNode<number>({ type: "float64" });
}

export function timestamp(): SchemaNode<string> {
  return createSchemaNode<string>({ type: "timestamp" });
}
