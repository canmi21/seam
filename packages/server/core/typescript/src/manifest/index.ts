/* packages/server/core/typescript/src/manifest/index.ts */

import type { Schema } from "jtd";
import type { SchemaNode } from "../types/schema.js";

export type ProcedureType = "query" | "subscription";

export interface ProcedureEntry {
  type: ProcedureType;
  input: Schema;
  output: Schema;
}

export interface ProcedureManifest {
  version: string;
  procedures: Record<string, ProcedureEntry>;
}

export function buildManifest(
  definitions: Record<string, { input: SchemaNode; output: SchemaNode; type?: string }>,
): ProcedureManifest {
  const mapped: ProcedureManifest["procedures"] = {};

  for (const [name, def] of Object.entries(definitions)) {
    mapped[name] = {
      type: def.type === "subscription" ? "subscription" : "query",
      input: def.input._schema,
      output: def.output._schema,
    };
  }

  return { version: "0.1.0", procedures: mapped };
}
