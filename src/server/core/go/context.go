/* src/server/core/go/context.go */

package seam

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// ContextConfig defines how a context field is extracted from an HTTP request.
type ContextConfig struct {
	Extract string // e.g. "header:authorization"
}

// contextKeyType is the key used to store context data in context.Context.
type contextKeyType struct{}

var seamContextKey = contextKeyType{}

// ContextValue retrieves a typed context value from the Go context.
// Returns the value and true if found and successfully unmarshaled,
// or the zero value and false otherwise.
func ContextValue[T any](ctx context.Context, key string) (T, bool) {
	var zero T
	raw, ok := ctx.Value(seamContextKey).(map[string]any)
	if !ok {
		return zero, false
	}
	val, exists := raw[key]
	if !exists || val == nil {
		return zero, false
	}

	// Fast path: if the value is already the target type
	if typed, ok := val.(T); ok {
		return typed, true
	}

	// Slow path: marshal then unmarshal for struct types
	b, err := json.Marshal(val)
	if err != nil {
		return zero, false
	}
	var result T
	if err := json.Unmarshal(b, &result); err != nil {
		return zero, false
	}
	return result, true
}

// parseExtractRule splits "header:authorization" into ("header", "authorization").
func parseExtractRule(rule string) (source, key string, ok bool) {
	parts := strings.SplitN(rule, ":", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// extractRawContext extracts raw values from request headers, cookies, and query params.
func extractRawContext(r *http.Request, configs map[string]ContextConfig) map[string]any {
	raw := make(map[string]any)
	for key, cfg := range configs {
		source, extractKey, ok := parseExtractRule(cfg.Extract)
		if !ok {
			raw[key] = nil
			continue
		}
		switch source {
		case "header":
			val := r.Header.Get(extractKey)
			if val == "" {
				raw[key] = nil
			} else {
				var parsed any
				if err := json.Unmarshal([]byte(val), &parsed); err != nil {
					parsed = val
				}
				raw[key] = parsed
			}
		case "cookie":
			cookie, err := r.Cookie(extractKey)
			if err != nil {
				raw[key] = nil
			} else {
				var parsed any
				if err := json.Unmarshal([]byte(cookie.Value), &parsed); err != nil {
					parsed = cookie.Value
				}
				raw[key] = parsed
			}
		case "query":
			val := r.URL.Query().Get(extractKey)
			if val == "" {
				raw[key] = nil
			} else {
				var parsed any
				if err := json.Unmarshal([]byte(val), &parsed); err != nil {
					parsed = val
				}
				raw[key] = parsed
			}
		default:
			raw[key] = nil
		}
	}
	return raw
}

// resolveContextForProc filters raw context to only the keys declared by a procedure.
func resolveContextForProc(raw map[string]any, contextKeys []string) map[string]any {
	if len(contextKeys) == 0 {
		return nil
	}
	filtered := make(map[string]any, len(contextKeys))
	for _, key := range contextKeys {
		filtered[key] = raw[key] // nil if not present
	}
	return filtered
}

// injectContext adds context data to a Go context via context.WithValue.
func injectContext(ctx context.Context, data map[string]any) context.Context {
	if data == nil {
		return ctx
	}
	return context.WithValue(ctx, seamContextKey, data)
}
