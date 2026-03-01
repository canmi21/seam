# JTD Schema Forms (RFC 8927)

All schemas in the SeamJS protocol conform to [RFC 8927 -- JSON Type Definition](https://www.rfc-editor.org/rfc/rfc8927). The eight schema forms are listed below.

## Empty

Accepts any JSON value.

```json
{}
```

## Ref

References a shared definition (not used in v1 manifests).

```json
{ "ref": "Address" }
```

## Type

A primitive type value.

```json
{ "type": "string" }
```

Supported `type` values:

| JTD type    | JSON representation | Notes           |
| ----------- | ------------------- | --------------- |
| `boolean`   | `true` / `false`    |                 |
| `string`    | JSON string         |                 |
| `timestamp` | JSON string         | RFC 3339 format |
| `float32`   | JSON number         | 32-bit float    |
| `float64`   | JSON number         | 64-bit float    |
| `int8`      | JSON number         | -128 to 127     |
| `uint8`     | JSON number         | 0 to 255        |
| `int16`     | JSON number         | -32768 to 32767 |
| `uint16`    | JSON number         | 0 to 65535      |
| `int32`     | JSON number         | -2^31 to 2^31-1 |
| `uint32`    | JSON number         | 0 to 2^32-1     |

## Enum

One of a fixed set of string values.

```json
{ "enum": ["PENDING", "ACTIVE", "DISABLED"] }
```

## Elements

A JSON array where every element matches the given schema.

```json
{ "elements": { "type": "string" } }
```

## Properties

A JSON object with typed fields. Fields in `properties` are required;
fields in `optionalProperties` may be omitted.

```json
{
  "properties": {
    "name": { "type": "string" },
    "age": { "type": "int32" }
  },
  "optionalProperties": {
    "email": { "type": "string" }
  }
}
```

## Values

A JSON object where all values match the given schema (string-keyed map).

```json
{ "values": { "type": "float64" } }
```

## Discriminator

A tagged union. The `tag` field determines which `mapping` entry applies.

```json
{
  "discriminator": "type",
  "mapping": {
    "email": {
      "properties": {
        "address": { "type": "string" }
      }
    },
    "sms": {
      "properties": {
        "phone": { "type": "string" }
      }
    }
  }
}
```

## Nullable Modifier

Any schema form (except empty) can be wrapped with `"nullable": true` to
additionally accept `null`.

```json
{ "type": "string", "nullable": true }
```
