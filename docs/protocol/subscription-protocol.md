# Subscription Protocol Specification (SSE)

## Overview

Subscriptions provide real-time streaming data from server to client using
Server-Sent Events (SSE). A subscription is a named stream endpoint that
accepts input parameters and yields a sequence of typed values.

## Endpoint

```
GET /_seam/procedure/{subscriptionName}?input={json}
```

| Parameter          | Location | Description                                               |
| ------------------ | -------- | --------------------------------------------------------- |
| `subscriptionName` | path     | Name of the subscription (from manifest)                  |
| `input`            | query    | URL-encoded JSON matching the subscription's input schema |

When `input` is omitted, the server defaults to `{}`.

## Response

The server responds with `Content-Type: text/event-stream` and streams
SSE events. The connection stays open until the stream completes, an
error occurs, or the client disconnects.

## Event Types

### `data`

A single value from the subscription stream.

```
event: data
data: {"n":1}
```

The `data` payload is JSON matching the subscription's output schema.

### `error`

An error occurred during the subscription.

```
event: error
data: {"code":"VALIDATION_ERROR","message":"Input validation failed","transient":false}
```

The `transient` field indicates whether the error is temporary and the client may retry. Defaults to `false`.

Error codes reuse the same set as procedure errors. See [Error Codes](./error-codes.md) for the full list.

After an `error` event the server closes the stream.

### `complete`

The subscription stream has finished normally.

```
event: complete
data: {}
```

After a `complete` event the server closes the connection.

## Manifest Integration

Subscriptions appear in the procedure manifest alongside regular procedures.
They are distinguished by the `kind` field:

```json
{
	"version": 2,
	"context": {},
	"procedures": {
		"greet": {
			"kind": "query",
			"input": { "properties": { "name": { "type": "string" } } },
			"output": { "properties": { "message": { "type": "string" } } }
		},
		"onCount": {
			"kind": "subscription",
			"input": { "properties": { "max": { "type": "int32" } } },
			"output": { "properties": { "n": { "type": "int32" } } }
		}
	},
	"transportDefaults": {}
}
```

The `kind` field defaults to `"query"` when absent (backward compatible). The `"type"` alias is accepted for v1 compatibility.

**Subscription vs Stream**: both use SSE, but they differ in direction and schema:

- **Subscription** (`GET`, `output`): server pushes events without client input beyond the initial request.
- **Stream** (`POST`, `chunkOutput`): client sends input via POST body, server responds with SSE events carrying incrementing `id` fields.

See [Procedure Manifest](./procedure-manifest.md) for full stream details.

## WebSocket Alternative

Channel subscriptions (`{channel}.events`) can also be consumed over WebSocket, which enables bidirectional communication -- the client can invoke channel commands over the same connection. See [Channel Protocol](./channel-protocol.md) for the WebSocket wire format.

When a WebSocket `Upgrade` header is present on a channel subscription request, the server upgrades the connection instead of starting an SSE stream.

## Client Disconnect

When the client closes the SSE connection (e.g. by calling `EventSource.close()`
or navigating away), the server should detect the broken pipe and stop
producing values. Cleanup logic in subscription handlers should release
resources promptly.

## Error Handling

### HTTP-level errors

If the server can detect the error before starting the SSE stream (e.g.
empty subscription name, unparseable input query parameter), it returns
a regular JSON error response with the appropriate HTTP status code.

### Stream-level errors

If the error occurs after the SSE stream has started (e.g. the subscription
name is unknown, input fails validation, or the handler throws), the server
sends an `error` SSE event and closes the stream.
