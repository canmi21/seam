/* src/server/core/typescript/src/channel.ts */

import type { Schema } from "jtd";
import type { SchemaNode, Infer, JTDSchema } from "./types/schema.js";
import type { CommandDef, SubscriptionDef, DefinitionMap } from "./router/index.js";

// -- Public types --

export interface IncomingDef<TIn = unknown, TOut = unknown> {
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  error?: SchemaNode;
  handler: (params: { input: TIn }) => TOut | Promise<TOut>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ChannelDef<
  TChannelIn = unknown,
  TIncoming extends Record<string, IncomingDef<any, any>> = Record<string, IncomingDef<any, any>>,
  TOutgoing extends Record<string, SchemaNode<Record<string, unknown>>> = Record<
    string,
    SchemaNode<Record<string, unknown>>
  >,
> {
  input: SchemaNode<TChannelIn>;
  incoming: TIncoming;
  outgoing: TOutgoing;
  subscribe: (params: { input: TChannelIn }) => AsyncIterable<ChannelEvent<TOutgoing>>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type ChannelEvent<TOutgoing extends Record<string, SchemaNode<Record<string, unknown>>>> = {
  [K in keyof TOutgoing & string]: { type: K; payload: Infer<TOutgoing[K]> };
}[keyof TOutgoing & string];

/** IR hint stored in the manifest `channels` field */
export interface ChannelMeta {
  input: Schema;
  incoming: Record<string, { input: Schema; output: Schema; error?: Schema }>;
  outgoing: Record<string, Schema>;
}

export interface ChannelResult {
  /** Expanded Level 0 procedure definitions — spread into createRouter */
  procedures: DefinitionMap;
  /** IR hint for codegen */
  channelMeta: ChannelMeta;
}

// -- Helpers --

/** Merge channel-level and message-level JTD properties schemas */
function mergeObjectSchemas(channel: JTDSchema, message: JTDSchema): JTDSchema {
  const channelProps = (channel as Record<string, unknown>).properties as
    | Record<string, JTDSchema>
    | undefined;
  const channelOptional = (channel as Record<string, unknown>).optionalProperties as
    | Record<string, JTDSchema>
    | undefined;
  const msgProps = (message as Record<string, unknown>).properties as
    | Record<string, JTDSchema>
    | undefined;
  const msgOptional = (message as Record<string, unknown>).optionalProperties as
    | Record<string, JTDSchema>
    | undefined;

  const merged: Record<string, unknown> = {};

  const props = { ...channelProps, ...msgProps };
  if (Object.keys(props).length > 0) {
    merged.properties = props;
  }

  const optProps = { ...channelOptional, ...msgOptional };
  if (Object.keys(optProps).length > 0) {
    merged.optionalProperties = optProps;
  }

  // Empty object schema needs at least empty properties
  if (!merged.properties && !merged.optionalProperties) {
    merged.properties = {};
  }

  return merged as JTDSchema;
}

/** Build a tagged union schema from outgoing event definitions */
function buildOutgoingUnionSchema(
  outgoing: Record<string, SchemaNode<Record<string, unknown>>>,
): JTDSchema {
  const mapping: Record<string, JTDSchema> = {};
  for (const [eventName, node] of Object.entries(outgoing)) {
    // Wrap each outgoing payload as a "payload" property
    mapping[eventName] = {
      properties: { payload: node._schema },
    } as JTDSchema;
  }
  return { discriminator: "type", mapping } as JTDSchema;
}

// -- Main API --

/* eslint-disable @typescript-eslint/no-explicit-any */
export function createChannel<
  TChannelIn,
  TIncoming extends Record<string, IncomingDef<any, any>>,
  TOutgoing extends Record<string, SchemaNode<Record<string, unknown>>>,
>(name: string, def: ChannelDef<TChannelIn, TIncoming, TOutgoing>): ChannelResult {
  const procedures: DefinitionMap = {};
  const channelInputSchema = def.input._schema;

  // Expand incoming messages to command procedures
  for (const [msgName, msgDef] of Object.entries(def.incoming)) {
    const mergedInputSchema = mergeObjectSchemas(channelInputSchema, msgDef.input._schema);

    const command: CommandDef<any, any> = {
      type: "command",
      input: { _schema: mergedInputSchema } as SchemaNode<any>,
      output: msgDef.output,
      handler: msgDef.handler as CommandDef<any, any>["handler"],
    };
    if (msgDef.error) {
      command.error = msgDef.error;
    }
    procedures[`${name}.${msgName}`] = command;
  }

  // Expand subscribe to a subscription with tagged union output
  const unionSchema = buildOutgoingUnionSchema(def.outgoing);
  const subscription: SubscriptionDef<any, any> = {
    type: "subscription",
    input: def.input as SchemaNode<any>,
    output: { _schema: unionSchema } as SchemaNode<any>,
    handler: def.subscribe as SubscriptionDef<any, any>["handler"],
  };
  procedures[`${name}.events`] = subscription;

  // Build channel metadata for manifest IR hint
  const incomingMeta: ChannelMeta["incoming"] = {};
  for (const [msgName, msgDef] of Object.entries(def.incoming)) {
    const entry: { input: Schema; output: Schema; error?: Schema } = {
      input: msgDef.input._schema,
      output: msgDef.output._schema,
    };
    if (msgDef.error) {
      entry.error = msgDef.error._schema;
    }
    incomingMeta[msgName] = entry;
  }

  const outgoingMeta: ChannelMeta["outgoing"] = {};
  for (const [eventName, node] of Object.entries(def.outgoing)) {
    outgoingMeta[eventName] = node._schema;
  }

  const channelMeta: ChannelMeta = {
    input: channelInputSchema,
    incoming: incomingMeta,
    outgoing: outgoingMeta,
  };

  return { procedures, channelMeta };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
