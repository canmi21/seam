/* src/server/core/typescript/__tests__/types.test.ts */

import { describe, expect, it } from "vitest";
import { t } from "../src/types/index.js";

describe("primitive types", () => {
  it("t.string() produces JTD type schema", () => {
    expect(t.string()._schema).toEqual({ type: "string" });
  });

  it("t.boolean() produces JTD type schema", () => {
    expect(t.boolean()._schema).toEqual({ type: "boolean" });
  });

  it("t.int8() produces JTD type schema", () => {
    expect(t.int8()._schema).toEqual({ type: "int8" });
  });

  it("t.int16() produces JTD type schema", () => {
    expect(t.int16()._schema).toEqual({ type: "int16" });
  });

  it("t.int32() produces JTD type schema", () => {
    expect(t.int32()._schema).toEqual({ type: "int32" });
  });

  it("t.uint8() produces JTD type schema", () => {
    expect(t.uint8()._schema).toEqual({ type: "uint8" });
  });

  it("t.uint16() produces JTD type schema", () => {
    expect(t.uint16()._schema).toEqual({ type: "uint16" });
  });

  it("t.uint32() produces JTD type schema", () => {
    expect(t.uint32()._schema).toEqual({ type: "uint32" });
  });

  it("t.float32() produces JTD type schema", () => {
    expect(t.float32()._schema).toEqual({ type: "float32" });
  });

  it("t.float64() produces JTD type schema", () => {
    expect(t.float64()._schema).toEqual({ type: "float64" });
  });

  it("t.timestamp() produces JTD type schema", () => {
    expect(t.timestamp()._schema).toEqual({ type: "timestamp" });
  });

  it("t.html() produces JTD string schema with html metadata", () => {
    expect(t.html()._schema).toEqual({ type: "string", metadata: { format: "html" } });
  });
});

describe("composite types", () => {
  it("t.object() splits required and optional fields", () => {
    const schema = t.object({
      name: t.string(),
      age: t.int32(),
      email: t.optional(t.string()),
    });
    expect(schema._schema).toEqual({
      properties: {
        name: { type: "string" },
        age: { type: "int32" },
      },
      optionalProperties: {
        email: { type: "string" },
      },
    });
  });

  it("t.object() with all required fields omits optionalProperties", () => {
    const schema = t.object({ x: t.int32() });
    expect(schema._schema).toEqual({
      properties: { x: { type: "int32" } },
    });
  });

  it("t.object() with empty fields produces empty properties", () => {
    const schema = t.object({});
    expect(schema._schema).toEqual({ properties: {} });
  });

  it("t.array() produces JTD elements schema", () => {
    const schema = t.array(t.string());
    expect(schema._schema).toEqual({ elements: { type: "string" } });
  });

  it("t.nullable() adds nullable flag", () => {
    const schema = t.nullable(t.string());
    expect(schema._schema).toEqual({ type: "string", nullable: true });
  });

  it("t.enum() produces JTD enum schema", () => {
    const schema = t.enum(["ACTIVE", "DISABLED"] as const);
    expect(schema._schema).toEqual({ enum: ["ACTIVE", "DISABLED"] });
  });

  it("t.values() produces JTD values schema", () => {
    const schema = t.values(t.float64());
    expect(schema._schema).toEqual({ values: { type: "float64" } });
  });

  it("t.discriminator() produces JTD discriminator schema", () => {
    const schema = t.discriminator("type", {
      email: t.object({ address: t.string() }),
      sms: t.object({ phone: t.string() }),
    });
    expect(schema._schema).toEqual({
      discriminator: "type",
      mapping: {
        email: { properties: { address: { type: "string" } } },
        sms: { properties: { phone: { type: "string" } } },
      },
    });
  });

  it("nested composites produce correct schema", () => {
    const schema = t.object({
      users: t.array(
        t.object({
          name: t.string(),
          tags: t.values(t.boolean()),
        }),
      ),
    });
    expect(schema._schema).toEqual({
      properties: {
        users: {
          elements: {
            properties: {
              name: { type: "string" },
              tags: { values: { type: "boolean" } },
            },
          },
        },
      },
    });
  });
});
