/* packages/server/core/typescript/src/manifest/index.ts */

import type { Schema } from "jtd";
import type { SchemaNode } from "../types/schema.js";

export interface ProcedureManifest {
  version: string;
  procedures: Record<string, { input: Schema; output: Schema }>;
}

export function buildManifest(
  procedures: Record<string, { input: SchemaNode; output: SchemaNode }>,
): ProcedureManifest {
  const mapped: ProcedureManifest["procedures"] = {};

  for (const [name, def] of Object.entries(procedures)) {
    mapped[name] = {
      input: def.input._schema,
      output: def.output._schema,
    };
  }

  return { version: "0.1.0", procedures: mapped };
}
