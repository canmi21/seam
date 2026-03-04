/* src/server/core/typescript/src/manifest/index.ts */

import type { Schema } from "jtd";
import type { SchemaNode } from "../types/schema.js";
import type { ChannelMeta } from "../channel.js";

export type ProcedureType = "query" | "command" | "subscription" | "stream" | "upload";

export interface NormalizedMappingValue {
  from: string;
  each?: boolean;
}

export interface NormalizedInvalidateTarget {
  query: string;
  mapping?: Record<string, NormalizedMappingValue>;
}

export interface ProcedureEntry {
  kind: ProcedureType;
  input: Schema;
  output?: Schema;
  chunkOutput?: Schema;
  error?: Schema;
  invalidates?: NormalizedInvalidateTarget[];
}

export interface ProcedureManifest {
  version: number;
  context: Record<string, never>;
  procedures: Record<string, ProcedureEntry>;
  channels?: Record<string, ChannelMeta>;
  transportDefaults: Record<string, never>;
}

type InvalidateInput = Array<
  | string
  | {
      query: string;
      mapping?: Record<string, string | { from: string; each?: boolean }>;
    }
>;

function normalizeInvalidates(targets: InvalidateInput): NormalizedInvalidateTarget[] {
  return targets.map((t) => {
    if (typeof t === "string") return { query: t };
    const normalized: NormalizedInvalidateTarget = { query: t.query };
    if (t.mapping) {
      normalized.mapping = Object.fromEntries(
        Object.entries(t.mapping).map(([k, v]) => [k, typeof v === "string" ? { from: v } : v]),
      );
    }
    return normalized;
  });
}

export function buildManifest(
  definitions: Record<
    string,
    {
      input: SchemaNode;
      output: SchemaNode;
      kind?: string;
      type?: string;
      error?: SchemaNode;
      invalidates?: InvalidateInput;
    }
  >,
  channels?: Record<string, ChannelMeta>,
): ProcedureManifest {
  const mapped: ProcedureManifest["procedures"] = {};

  for (const [name, def] of Object.entries(definitions)) {
    const k = def.kind ?? def.type;
    const kind: ProcedureType =
      k === "upload"
        ? "upload"
        : k === "stream"
          ? "stream"
          : k === "subscription"
            ? "subscription"
            : k === "command"
              ? "command"
              : "query";
    const entry: ProcedureEntry = { kind, input: def.input._schema };
    if (kind === "stream") {
      entry.chunkOutput = def.output._schema;
    } else {
      entry.output = def.output._schema;
    }
    if (def.error) {
      entry.error = def.error._schema;
    }
    if (kind === "command" && def.invalidates && def.invalidates.length > 0) {
      entry.invalidates = normalizeInvalidates(def.invalidates);
    }
    mapped[name] = entry;
  }

  const manifest: ProcedureManifest = {
    version: 2,
    context: {},
    procedures: mapped,
    transportDefaults: {},
  };
  if (channels && Object.keys(channels).length > 0) {
    manifest.channels = channels;
  }
  return manifest;
}
