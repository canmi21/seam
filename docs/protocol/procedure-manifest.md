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
  "version": 2,
  "context": {
    "<contextKey>": { "extract": "<extractorName>", "schema": <JTD schema> }
  },
  "procedures": {
    "<procedureName>": <ProcedureSchema>
  },
  "channels": {
    "<channelName>": <ChannelMeta>
  },
  "transportDefaults": {
    "<procedureKind>": { "prefer": "<transport>", "fallback": ["<transport>"] }
  }
}
```

| Field               | Type                              | Description                                                                                          |
| ------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `version`           | `number`                          | Manifest format version. Currently `2`.                                                              |
| `context`           | `Record<string, ContextSchema>`   | Declarative context extractors. Each key names a context field; the value defines how to extract it. |
| `procedures`        | `Record<string, ProcedureSchema>` | Map of procedure name to its schema.                                                                 |
| `channels`          | `Record<string, ChannelMeta>`     | Optional. Channel metadata for codegen. See [Channel Protocol](./channel-protocol.md).               |
| `transportDefaults` | `Record<string, TransportConfig>` | Default transport preferences per procedure kind (e.g. `"subscription": { "prefer": "ws" }`).        |

## ProcedureSchema

| Field         | Type                                                             | Description                                                                                  |
| ------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `kind`        | `"query" \| "command" \| "subscription" \| "stream" \| "upload"` | Procedure kind. Defaults to `"query"` if absent.                                             |
| `input`       | `JTDSchema`                                                      | JTD schema for the request body. Empty `{}` means no input.                                  |
| `output`      | `JTDSchema`                                                      | JTD schema for the response body. Used by query, command, subscription, and upload.          |
| `chunkOutput` | `JTDSchema`                                                      | JTD schema for each chunk in a stream. Used instead of `output` for stream procedures.       |
| `error`       | `JTDSchema`                                                      | Optional. JTD schema for typed error payloads.                                               |
| `invalidates` | `InvalidateTarget[]`                                             | Optional. Queries to invalidate when this command succeeds. Only valid on commands.          |
| `context`     | `string[]`                                                       | Optional. Context keys this procedure requires (must reference keys in top-level `context`). |
| `transport`   | `TransportConfig`                                                | Optional. Per-procedure transport preference, overrides `transportDefaults`.                 |

## Procedure Kinds

- **`query`** -- read-only operation. Safe to retry and cache.
- **`command`** -- operation with side effects. Not safe to retry blindly. May declare `invalidates` to auto-invalidate cached queries.
- **`subscription`** -- server-to-client streaming via SSE or WebSocket. Uses `output` for each emitted value. See [Subscription Protocol](./subscription-protocol.md).
- **`stream`** -- client-initiated streaming via POST + SSE response. Uses `chunkOutput` for each chunk (not `output`). Each SSE event carries an incrementing `id`.
- **`upload`** -- file upload via multipart/form-data. Receives a `SeamFileHandle` alongside JSON input. Uses `output` for the response.

## Context

Top-level `context` defines named extractors that pull values from the raw request context (headers, cookies, etc.). Procedures reference context keys via the `context` array field; at runtime the server resolves only the requested keys.

```json
{
	"context": {
		"auth": {
			"extract": "extractAuth",
			"schema": { "properties": { "userId": { "type": "string" } } }
		}
	}
}
```

A `ContextSchema` has:

| Field     | Type        | Description                                              |
| --------- | ----------- | -------------------------------------------------------- |
| `extract` | `string`    | Name of the extractor function registered on the server. |
| `schema`  | `JTDSchema` | JTD schema for the extracted context value.              |

## Invalidation

Commands may declare which queries to invalidate on success:

```json
{
	"invalidates": [
		{ "query": "getPost" },
		{ "query": "listPosts", "mapping": { "authorId": { "from": "userId" } } }
	]
}
```

An `InvalidateTarget` has:

| Field     | Type                           | Description                                                 |
| --------- | ------------------------------ | ----------------------------------------------------------- |
| `query`   | `string`                       | Name of the query procedure to invalidate.                  |
| `mapping` | `Record<string, MappingValue>` | Optional. Maps command output fields to query input fields. |

A `MappingValue` has:

| Field  | Type      | Description                                                         |
| ------ | --------- | ------------------------------------------------------------------- |
| `from` | `string`  | Source field name from the command's output.                        |
| `each` | `boolean` | Optional. When `true`, the source is an array; invalidate per item. |

## Transport Configuration

Transport preferences control how the client communicates with procedures. They can be set globally per procedure kind via `transportDefaults`, or per procedure via the `transport` field.

```json
{
	"transportDefaults": {
		"subscription": { "prefer": "ws", "fallback": ["sse"] }
	}
}
```

A `TransportConfig` has:

| Field      | Type                    | Description                                                        |
| ---------- | ----------------------- | ------------------------------------------------------------------ |
| `prefer`   | `TransportPreference`   | Preferred transport: `"http"`, `"sse"`, `"ws"`, or `"ipc"`.        |
| `fallback` | `TransportPreference[]` | Optional. Ordered fallback transports if preferred is unavailable. |

Per-procedure `transport` overrides `transportDefaults` for that specific procedure.

## Backward Compatibility

The `"type"` field is accepted as an alias for `"kind"` when deserializing (v1 manifests use `"type"`). Serialization always outputs `"kind"`. The `version` field distinguishes v1 (`version: 1`, no `context`/`transportDefaults`) from v2.

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

Executes a query, command, stream, or upload procedure.

**Request** (query/command):

- Content-Type: `application/json`
- Body: JSON matching the procedure's `input` schema.

**Response** (success):

- Status: `200`
- Content-Type: `application/json`
- Body: `{ "ok": true, "data": <output> }`

**Request** (stream):

- Content-Type: `application/json`
- Body: JSON matching the procedure's `input` schema.

**Response** (stream):

- Status: `200`
- Content-Type: `text/event-stream`
- Body: SSE events with incrementing `id`, each `data:` payload matching `chunkOutput` schema. Ends with `event: complete`.

**Request** (upload):

- Content-Type: `multipart/form-data`
- Body: form data with JSON `input` field and file attachment.

**Response** (upload success):

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
	"version": 2,
	"context": {
		"auth": {
			"extract": "extractAuth",
			"schema": {
				"properties": {
					"userId": { "type": "string" }
				}
			}
		}
	},
	"procedures": {
		"greet": {
			"kind": "query",
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
			"kind": "command",
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
			},
			"invalidates": [{ "query": "listUsers" }],
			"context": ["auth"]
		},
		"onCount": {
			"kind": "subscription",
			"input": {
				"properties": {
					"max": { "type": "int32" }
				}
			},
			"output": {
				"properties": {
					"n": { "type": "int32" }
				}
			}
		},
		"generateReport": {
			"kind": "stream",
			"input": {
				"properties": {
					"topic": { "type": "string" }
				}
			},
			"chunkOutput": {
				"properties": {
					"text": { "type": "string" }
				}
			}
		},
		"uploadAvatar": {
			"kind": "upload",
			"input": {
				"properties": {
					"userId": { "type": "string" }
				}
			},
			"output": {
				"properties": {
					"url": { "type": "string" }
				}
			},
			"context": ["auth"]
		}
	},
	"transportDefaults": {
		"subscription": { "prefer": "ws", "fallback": ["sse"] }
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

**generateReport (stream)**

```
POST /_seam/procedure/generateReport
Content-Type: application/json

{ "topic": "Q4 results" }
```

```
200 OK
Content-Type: text/event-stream

id: 0
event: data
data: {"text":"## Q4 Results\n"}

id: 1
event: data
data: {"text":"Revenue grew 15%..."}

event: complete
data: {}
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
