# Subscription Protocol Specification (SSE)

## Overview

Subscriptions provide real-time streaming data from server to client using
Server-Sent Events (SSE). A subscription is a named stream endpoint that
accepts input parameters and yields a sequence of typed values.

## Endpoint

```
GET /_seam/subscribe/{subscriptionName}?input={json}
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
data: {"code":"VALIDATION_ERROR","message":"Input validation failed"}
```

Error codes reuse the same set as RPC errors:

| Code               | Meaning                                 |
| ------------------ | --------------------------------------- |
| `VALIDATION_ERROR` | Input failed schema validation          |
| `NOT_FOUND`        | Subscription name not found             |
| `INTERNAL_ERROR`   | Unhandled error in subscription handler |

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
They are distinguished by the `type` field:

```json
{
  "version": "0.1.0",
  "procedures": {
    "greet": {
      "type": "query",
      "input": { "properties": { "name": { "type": "string" } } },
      "output": { "properties": { "message": { "type": "string" } } }
    },
    "onCount": {
      "type": "subscription",
      "input": { "properties": { "max": { "type": "int32" } } },
      "output": { "properties": { "n": { "type": "int32" } } }
    }
  }
}
```

The `type` field defaults to `"query"` when absent (backward compatible).

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
