/* packages/server/core/typescript/src/manifest/index.ts */

import type { Schema } from "jtd";
import type { SchemaNode } from "../types/schema.js";

export type ProcedureType = "query" | "command" | "subscription";

export interface ProcedureEntry {
  type: ProcedureType;
  input: Schema;
  output: Schema;
  error?: Schema;
}

export interface ProcedureManifest {
  version: number;
  procedures: Record<string, ProcedureEntry>;
}

export function buildManifest(
  definitions: Record<
    string,
    { input: SchemaNode; output: SchemaNode; type?: string; error?: SchemaNode }
  >,
): ProcedureManifest {
  const mapped: ProcedureManifest["procedures"] = {};

  for (const [name, def] of Object.entries(definitions)) {
    const type: ProcedureType =
      def.type === "subscription" ? "subscription" : def.type === "command" ? "command" : "query";
    const entry: ProcedureEntry = {
      type,
      input: def.input._schema,
      output: def.output._schema,
    };
    if (def.error) {
      entry.error = def.error._schema;
    }
    mapped[name] = entry;
  }

  return { version: 1, procedures: mapped };
}
