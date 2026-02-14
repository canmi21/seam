/* packages/server/core/typescript/src/types/composites.ts */

import type { SchemaNode, OptionalSchemaNode, Infer, JTDSchema } from "./schema.js";
import { createSchemaNode, createOptionalSchemaNode } from "./schema.js";

// -- Type-level utilities --

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type RequiredKeys<T extends Record<string, SchemaNode>> = {
  [K in keyof T]: T[K] extends OptionalSchemaNode ? never : K;
}[keyof T];

type OptionalKeys<T extends Record<string, SchemaNode>> = {
  [K in keyof T]: T[K] extends OptionalSchemaNode ? K : never;
}[keyof T];

type InferObject<T extends Record<string, SchemaNode>> = Simplify<
  { [K in RequiredKeys<T>]: Infer<T[K]> } & { [K in OptionalKeys<T>]?: Infer<T[K]> }
>;

// -- Builders --

export function object<T extends Record<string, SchemaNode>>(
  fields: T,
): SchemaNode<InferObject<T>> {
  const properties: Record<string, JTDSchema> = {};
  const optionalProperties: Record<string, JTDSchema> = {};

  for (const [key, node] of Object.entries(fields)) {
    if ("_optional" in node && node._optional === true) {
      optionalProperties[key] = node._schema;
    } else {
      properties[key] = node._schema;
    }
  }

  const schema: Record<string, unknown> = {};
  if (Object.keys(properties).length > 0 || Object.keys(optionalProperties).length === 0) {
    schema.properties = properties;
  }
  if (Object.keys(optionalProperties).length > 0) {
    schema.optionalProperties = optionalProperties;
  }

  return createSchemaNode<InferObject<T>>(schema as JTDSchema);
}

export function optional<T>(node: SchemaNode<T>): OptionalSchemaNode<T> {
  return createOptionalSchemaNode<T>(node._schema);
}

export function array<T>(node: SchemaNode<T>): SchemaNode<T[]> {
  return createSchemaNode<T[]>({ elements: node._schema });
}

export function nullable<T>(node: SchemaNode<T>): SchemaNode<T | null> {
  return createSchemaNode<T | null>({ ...node._schema, nullable: true } as JTDSchema);
}

export function enumType<const T extends readonly string[]>(values: T): SchemaNode<T[number]> {
  return createSchemaNode<T[number]>({ enum: [...values] } as JTDSchema);
}

export function values<T>(node: SchemaNode<T>): SchemaNode<Record<string, T>> {
  return createSchemaNode<Record<string, T>>({ values: node._schema });
}

type DiscriminatorUnion<TTag extends string, TMapping extends Record<string, SchemaNode>> = {
  [K in keyof TMapping & string]: Simplify<{ [P in TTag]: K } & Infer<TMapping[K]>>;
}[keyof TMapping & string];

export function discriminator<
  TTag extends string,
  TMapping extends Record<string, SchemaNode<Record<string, unknown>>>,
>(tag: TTag, mapping: TMapping): SchemaNode<DiscriminatorUnion<TTag, TMapping>> {
  const jtdMapping: Record<string, JTDSchema> = {};
  for (const [key, node] of Object.entries(mapping)) {
    jtdMapping[key] = node._schema;
  }
  return createSchemaNode<DiscriminatorUnion<TTag, TMapping>>({
    discriminator: tag,
    mapping: jtdMapping,
  } as JTDSchema);
}
