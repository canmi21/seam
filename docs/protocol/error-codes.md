# Error Codes

All error responses in the SeamJS protocol use a consistent envelope:

```json
{
  "ok": false,
  "error": {
    "code": "<ERROR_CODE>",
    "message": "<human-readable description>",
    "transient": false
  }
}
```

The `transient` field indicates whether the error is temporary and the client may retry the request. Defaults to `false`. Examples of transient errors: rate limiting, timeouts, temporary unavailability.

## Standard Codes

| Code               | HTTP Status | Meaning                               |
| ------------------ | ----------- | ------------------------------------- |
| `VALIDATION_ERROR` | 400         | Request body failed input validation. |
| `UNAUTHORIZED`     | 401         | Missing or invalid authentication.    |
| `FORBIDDEN`        | 403         | Insufficient permissions.             |
| `NOT_FOUND`        | 404         | Procedure name not found in manifest. |
| `RATE_LIMITED`     | 429         | Too many requests.                    |
| `INTERNAL_ERROR`   | 500         | Unhandled error in procedure handler. |

Servers may use any string as an error code. Custom codes default to HTTP 500 unless an explicit status is provided.
