import type { Schema } from "jtd";

export type JTDSchema = Schema;

export interface SchemaNode<TOutput = unknown> {
  readonly _schema: JTDSchema;
  /** Phantom type marker — never exists at runtime */
  readonly _output: TOutput;
}

export interface OptionalSchemaNode<TOutput = unknown> extends SchemaNode<TOutput> {
  readonly _optional: true;
}

export type Infer<T extends SchemaNode> = T["_output"];

export function createSchemaNode<T>(schema: JTDSchema): SchemaNode<T> {
  return { _schema: schema } as SchemaNode<T>;
}

export function createOptionalSchemaNode<T>(schema: JTDSchema): OptionalSchemaNode<T> {
  return { _schema: schema, _optional: true } as OptionalSchemaNode<T>;
}
