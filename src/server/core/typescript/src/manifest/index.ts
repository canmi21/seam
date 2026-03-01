/* src/server/core/typescript/src/manifest/index.ts */

import type { Schema } from "jtd";
import type { SchemaNode } from "../types/schema.js";
import type { ChannelMeta } from "../channel.js";

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
  channels?: Record<string, ChannelMeta>;
}

export function buildManifest(
  definitions: Record<
    string,
    { input: SchemaNode; output: SchemaNode; type?: string; error?: SchemaNode }
  >,
  channels?: Record<string, ChannelMeta>,
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

  const manifest: ProcedureManifest = { version: 1, procedures: mapped };
  if (channels && Object.keys(channels).length > 0) {
    manifest.channels = channels;
  }
  return manifest;
}
