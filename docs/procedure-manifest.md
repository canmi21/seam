# Procedure Manifest Specification

## Overview

A **Procedure Manifest** is a JSON document that describes all remote procedures
exposed by a SeamJS server. It serves as the single source of truth for the wire
contract between server and client: every procedure's name, input schema, and
output schema are declared here.

Consumers of the manifest include:

- **Clients** -- validate request/response shapes at runtime.
- **CLI codegen** -- generate typed client SDKs and Rust handlers.
- **Documentation tools** -- auto-generate API docs.

## Manifest Format

```json
{
  "version": "0.1.0",
  "procedures": {
    "<procedureName>": {
      "input": <JTD schema>,
      "output": <JTD schema>
    }
  }
}
```

| Field        | Type                              | Description                          |
| ------------ | --------------------------------- | ------------------------------------ |
| `version`    | `string`                          | Manifest format version (semver).    |
| `procedures` | `Record<string, ProcedureSchema>` | Map of procedure name to its schema. |

Each `ProcedureSchema` has:

| Field    | Type        | Description                                                              |
| -------- | ----------- | ------------------------------------------------------------------------ |
| `input`  | `JTDSchema` | JTD schema for the request body. Empty `{}` means no input.              |
| `output` | `JTDSchema` | JTD schema for the response body. Empty `{}` means no structured output. |

## Procedure Naming

Procedure names must match `[a-zA-Z][a-zA-Z0-9]*`. CamelCase is recommended.

Valid: `greet`, `getUser`, `listUsers`, `createOrderV2`
Invalid: `get-user`, `_internal`, `123go`, `get user`

## JTD Schema Forms (RFC 8927)

All schemas conform to [RFC 8927 -- JSON Type Definition](https://www.rfc-editor.org/rfc/rfc8927).
The eight schema forms are:

### Empty

Accepts any JSON value.

```json
{}
```

### Ref

References a shared definition (not used in v0.1.0 manifests).

```json
{ "ref": "Address" }
```

### Type

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

### Enum

One of a fixed set of string values.

```json
{ "enum": ["PENDING", "ACTIVE", "DISABLED"] }
```

### Elements

A JSON array where every element matches the given schema.

```json
{ "elements": { "type": "string" } }
```

### Properties

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

### Values

A JSON object where all values match the given schema (string-keyed map).

```json
{ "values": { "type": "float64" } }
```

### Discriminator

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

### Nullable Modifier

Any schema form (except empty) can be wrapped with `"nullable": true` to
additionally accept `null`.

```json
{ "type": "string", "nullable": true }
```

## HTTP Endpoints

### GET /seam/manifest.json

Returns the full procedure manifest as `application/json`.

**Response**: the manifest JSON document.

### POST /seam/rpc/{procedureName}

Executes a procedure.

**Request**:

- Content-Type: `application/json`
- Body: JSON matching the procedure's `input` schema.

**Response** (success):

- Status: `200`
- Content-Type: `application/json`
- Body: JSON matching the procedure's `output` schema.

## Error Response Format

All error responses use a consistent envelope:

```json
{
  "error": {
    "code": "<ERROR_CODE>",
    "message": "<human-readable description>"
  }
}
```

### Error Codes

| Code               | HTTP Status | Meaning                               |
| ------------------ | ----------- | ------------------------------------- |
| `VALIDATION_ERROR` | 400         | Request body failed input validation. |
| `NOT_FOUND`        | 404         | Procedure name not found in manifest. |
| `INTERNAL_ERROR`   | 500         | Unhandled error in procedure handler. |

## Complete Example

### Manifest

```json
{
  "version": "0.1.0",
  "procedures": {
    "greet": {
      "input": {
        "properties": {
          "name": { "type": "string" }
        }
      },
      "output": {
        "properties": {
          "message": { "type": "string" }
        }
      }
    },
    "getUser": {
      "input": {
        "properties": {
          "id": { "type": "uint32" }
        }
      },
      "output": {
        "properties": {
          "id": { "type": "uint32" },
          "name": { "type": "string" },
          "email": { "type": "string" }
        },
        "optionalProperties": {
          "avatar": { "type": "string", "nullable": true }
        }
      }
    },
    "listUsers": {
      "input": {},
      "output": {
        "elements": {
          "properties": {
            "id": { "type": "uint32" },
            "name": { "type": "string" }
          }
        }
      }
    }
  }
}
```

### Request / Response Examples

**greet**

```
POST /seam/rpc/greet
Content-Type: application/json

{ "name": "Alice" }
```

```
200 OK
Content-Type: application/json

{ "message": "Hello, Alice!" }
```

**getUser (not found)**

```
POST /seam/rpc/noSuchProcedure
Content-Type: application/json

{}
```

```
404 Not Found
Content-Type: application/json

{ "error": { "code": "NOT_FOUND", "message": "Procedure 'noSuchProcedure' not found" } }
```

**greet (validation error)**

```
POST /seam/rpc/greet
Content-Type: application/json

{ "name": 42 }
```

```
400 Bad Request
Content-Type: application/json

{ "error": { "code": "VALIDATION_ERROR", "message": "Input validation failed" } }
```
