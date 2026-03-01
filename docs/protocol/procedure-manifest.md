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
  "version": 1,
  "procedures": {
    "<procedureName>": {
      "type": "query" | "command" | "subscription",
      "input": <JTD schema>,
      "output": <JTD schema>,
      "error": <JTD schema>          // optional
    }
  },
  "channels": {                       // optional
    "<channelName>": <ChannelMeta>
  }
}
```

| Field        | Type                              | Description                                                                            |
| ------------ | --------------------------------- | -------------------------------------------------------------------------------------- |
| `version`    | `number`                          | Manifest format version. Currently `1`.                                                |
| `procedures` | `Record<string, ProcedureSchema>` | Map of procedure name to its schema.                                                   |
| `channels`   | `Record<string, ChannelMeta>`     | Optional. Channel metadata for codegen. See [Channel Protocol](./channel-protocol.md). |

Each `ProcedureSchema` has:

| Field    | Type                                     | Description                                                              |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `type`   | `"query" \| "command" \| "subscription"` | Procedure type. Defaults to `"query"` if absent.                         |
| `input`  | `JTDSchema`                              | JTD schema for the request body. Empty `{}` means no input.              |
| `output` | `JTDSchema`                              | JTD schema for the response body. Empty `{}` means no structured output. |
| `error`  | `JTDSchema`                              | Optional. JTD schema for typed error payloads.                           |

Procedure types:

- **`query`** -- read-only operation. Safe to retry and cache.
- **`command`** -- operation with side effects. Not safe to retry blindly.
- **`subscription`** -- streaming operation via SSE or WebSocket. See [Subscription Protocol](./subscription-protocol.md).

## Procedure Naming

Procedure names must match `[a-zA-Z][a-zA-Z0-9]*`. CamelCase is recommended.

Valid: `greet`, `getUser`, `listUsers`, `createOrderV2`
Invalid: `get-user`, `_internal`, `123go`, `get user`

Channel-expanded procedures use dot notation: `chat.send`, `chat.events`. The dot is reserved for channel expansion and must not appear in user-defined procedure names.

## JTD Schema Forms

All schemas conform to RFC 8927. See [JTD Schema Reference](./jtd-schema.md) for the full specification of all eight schema forms.

## HTTP Endpoints

### GET /\_seam/manifest.json

Returns the full procedure manifest as `application/json`.

**Response**: the manifest JSON document.

### POST /\_seam/procedure/{procedureName}

Executes a query or command procedure.

**Request**:

- Content-Type: `application/json`
- Body: JSON matching the procedure's `input` schema.

**Response** (success):

- Status: `200`
- Content-Type: `application/json`
- Body: `{ "ok": true, "data": <output> }`

### POST /\_seam/procedure/\_batch

Executes multiple procedures in a single HTTP request.

**Request**:

- Content-Type: `application/json`
- Body: JSON object with a `calls` array:

```json
{
  "calls": [
    { "procedure": "greet", "input": { "name": "Alice" } },
    { "procedure": "getUser", "input": { "id": 1 } }
  ]
}
```

**Response** (success):

- Status: `200`
- Content-Type: `application/json`
- Body: `{ "ok": true, "data": { "results": [...] } }`

Each item in `results` is either a success or an error:

```json
{
  "ok": true,
  "data": {
    "results": [
      { "ok": true, "data": { "message": "Hello, Alice!" } },
      { "ok": true, "data": { "id": 1, "name": "Alice", "email": "alice@example.com" } }
    ]
  }
}
```

Individual failures return error objects without failing the entire batch:

```json
{
  "ok": true,
  "data": {
    "results": [
      { "ok": true, "data": { "message": "Hello, Alice!" } },
      {
        "ok": false,
        "error": {
          "code": "NOT_FOUND",
          "message": "Procedure 'noSuch' not found",
          "transient": false
        }
      }
    ]
  }
}
```

### GET /\_seam/procedure/{subscriptionName}

SSE endpoint for subscriptions. See [Subscription Protocol](./subscription-protocol.md).

### GET /\_seam/page/{route}

Serves a fully rendered HTML page. The server matches the route to a page definition, runs all associated data loaders in parallel, injects loader results into the HTML skeleton template, and returns the complete document.

**Response** (success):

- Status: `200`
- Content-Type: `text/html`
- Body: HTML document with injected data and `__data` script tag

**Response** (not found):

- Status: `404` if no page definition matches the route

## RPC Hash Obfuscation

Servers may optionally map procedure names to SHA2 hashes for production deployments. When enabled, clients call `POST /_seam/procedure/{hash}` instead of `POST /_seam/procedure/{name}`.

The server maintains a reverse lookup map (`hash -> name`) provided via the `rpcHashMap` option. The CLI generates this map during `seam build` when obfuscation is enabled in `seam.toml`.

This is a deployment optimization, not a security boundary — the manifest endpoint still exposes procedure schemas by name.

## Error Response Format

See [Error Codes](./error-codes.md) for the error envelope format and standard error codes.

## Complete Example

### Manifest

```json
{
  "version": 1,
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
    "createUser": {
      "type": "command",
      "input": {
        "properties": {
          "name": { "type": "string" },
          "email": { "type": "string" }
        }
      },
      "output": {
        "properties": {
          "id": { "type": "uint32" },
          "name": { "type": "string" },
          "email": { "type": "string" }
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
POST /_seam/procedure/greet
Content-Type: application/json

{ "name": "Alice" }
```

```
200 OK
Content-Type: application/json

{ "ok": true, "data": { "message": "Hello, Alice!" } }
```

**createUser (not found)**

```
POST /_seam/procedure/noSuchProcedure
Content-Type: application/json

{}
```

```
404 Not Found
Content-Type: application/json

{ "ok": false, "error": { "code": "NOT_FOUND", "message": "Procedure 'noSuchProcedure' not found", "transient": false } }
```

**greet (validation error)**

```
POST /_seam/procedure/greet
Content-Type: application/json

{ "name": 42 }
```

```
400 Bad Request
Content-Type: application/json

{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "Input validation failed", "transient": false } }
```
