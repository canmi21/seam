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
      "type": "query" | "subscription",
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

| Field    | Type                        | Description                                                              |
| -------- | --------------------------- | ------------------------------------------------------------------------ |
| `type`   | `"query" \| "subscription"` | Procedure type. Defaults to `"query"` if absent.                         |
| `input`  | `JTDSchema`                 | JTD schema for the request body. Empty `{}` means no input.              |
| `output` | `JTDSchema`                 | JTD schema for the response body. Empty `{}` means no structured output. |

See [Subscription Protocol](./subscription-protocol.md) for SSE subscription details.

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

### GET /\_seam/manifest.json

Returns the full procedure manifest as `application/json`.

**Response**: the manifest JSON document.

### POST /\_seam/rpc/{procedureName}

Executes a procedure.

**Request**:

- Content-Type: `application/json`
- Body: JSON matching the procedure's `input` schema.

**Response** (success):

- Status: `200`
- Content-Type: `application/json`
- Body: JSON matching the procedure's `output` schema.

### POST /\_seam/rpc/\_batch

Executes multiple procedures in a single HTTP request.

**Request**:

- Content-Type: `application/json`
- Body: JSON array of call objects:

```json
[
  { "procedure": "greet", "input": { "name": "Alice" } },
  { "procedure": "getUser", "input": { "id": 1 } }
]
```

**Response** (success):

- Status: `200`
- Content-Type: `application/json`
- Body: JSON array of results in the same order:

```json
[
  { "result": { "message": "Hello, Alice!" } },
  { "result": { "id": 1, "name": "Alice", "email": "alice@example.com" } }
]
```

Individual failures return error objects in the array without failing the entire batch:

```json
[
  { "result": { "message": "Hello, Alice!" } },
  { "error": { "code": "NOT_FOUND", "message": "Procedure 'noSuch' not found" } }
]
```

### GET /\_seam/page/{route}

Serves a fully rendered HTML page. The server matches the route to a page definition, runs all associated data loaders in parallel, injects loader results into the HTML skeleton template, and returns the complete document.

**Response** (success):

- Status: `200`
- Content-Type: `text/html`
- Body: HTML document with injected data and `__SEAM_DATA__` script tag

**Response** (not found):

- Status: `404` if no page definition matches the route

## RPC Hash Obfuscation

Servers may optionally map procedure names to SHA2 hashes for production deployments. When enabled, clients call `POST /_seam/rpc/{hash}` instead of `POST /_seam/rpc/{name}`.

The server maintains a reverse lookup map (`hash -> name`) provided via the `rpcHashMap` option. The CLI generates this map during `seam build` when obfuscation is enabled in `seam.toml`.

This is a deployment optimization, not a security boundary — the manifest endpoint still exposes procedure schemas by name.

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
| `UNAUTHORIZED`     | 401         | Missing or invalid authentication.    |
| `FORBIDDEN`        | 403         | Insufficient permissions.             |
| `NOT_FOUND`        | 404         | Procedure name not found in manifest. |
| `RATE_LIMITED`     | 429         | Too many requests.                    |
| `INTERNAL_ERROR`   | 500         | Unhandled error in procedure handler. |

Servers may use any string as an error code. Custom codes default to HTTP 500 unless an explicit status is provided.

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
POST /_seam/rpc/greet
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
POST /_seam/rpc/noSuchProcedure
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
POST /_seam/rpc/greet
Content-Type: application/json

{ "name": 42 }
```

```
400 Bad Request
Content-Type: application/json

{ "error": { "code": "VALIDATION_ERROR", "message": "Input validation failed" } }
```
