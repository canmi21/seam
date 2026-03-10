/* src/server/core/go/handler_test.go */

package seam

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// slowHandler sleeps for the given duration, respecting context cancellation.
func slowHandler(d time.Duration) HandlerFunc {
	return func(ctx context.Context, input json.RawMessage) (any, error) {
		select {
		case <-time.After(d):
			return map[string]string{"ok": "true"}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func TestRPCTimeout(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{Name: "slow", Handler: slowHandler(100 * time.Millisecond)}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 10 * time.Millisecond}, ValidationModeNever,
	)

	req := httptest.NewRequest("POST", "/_seam/procedure/slow", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d", w.Code)
	}

	var resp map[string]map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"]["message"] != "RPC timed out" {
		t.Fatalf("unexpected error message: %s", resp["error"]["message"])
	}
}

func TestRPCZeroTimeout(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{Name: "slow", Handler: slowHandler(50 * time.Millisecond)}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 0}, ValidationModeNever,
	)

	req := httptest.NewRequest("POST", "/_seam/procedure/slow", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with zero timeout, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPageTimeout(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{Name: "fetchData", Handler: slowHandler(100 * time.Millisecond)}},
		nil, nil, nil, nil,
		[]PageDef{{
			Route:    "/test",
			Template: "<html>__SEAM_DATA__</html>",
			Loaders: []LoaderDef{{
				DataKey:   "data",
				Procedure: "fetchData",
				InputFn:   func(params map[string]string) any { return map[string]string{} },
			}},
		}},
		nil, nil, "", nil, nil,
		HandlerOptions{PageTimeout: 10 * time.Millisecond}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/_seam/page/test", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"]["message"] != "Page loader timed out" {
		t.Fatalf("unexpected error message: %s", resp["error"]["message"])
	}
}

func TestSSEIdleTimeout(t *testing.T) {
	// Send one event, then block forever. Idle timeout should fire.
	subHandler := func(ctx context.Context, input json.RawMessage) (<-chan SubscriptionEvent, error) {
		ch := make(chan SubscriptionEvent, 1)
		ch <- SubscriptionEvent{Value: "hello"}
		// Don't close ch — let idle timeout handle it
		return ch, nil
	}

	handler := buildHandler(
		nil,
		[]SubscriptionDef{{Name: "idle-test", Handler: subHandler}},
		nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{SSEIdleTimeout: 50 * time.Millisecond, HeartbeatInterval: 200 * time.Millisecond}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/_seam/procedure/idle-test", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()
	if !strings.Contains(body, "event: data") {
		t.Fatalf("expected data event, got: %s", body)
	}
	if !strings.Contains(body, "event: complete") {
		t.Fatalf("expected complete event after idle timeout, got: %s", body)
	}
}

func echoHandler() HandlerFunc {
	return func(ctx context.Context, input json.RawMessage) (any, error) {
		var data any
		_ = json.Unmarshal(input, &data)
		return data, nil
	}
}

func validationHandler() http.Handler {
	return buildHandler(
		[]ProcedureDef{{
			Name:        "greet",
			InputSchema: map[string]any{"properties": map[string]any{"name": map[string]any{"type": "string"}}},
			Handler:     echoHandler(),
		}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeAlways,
	)
}

func TestValidationRejectsInvalidInput(t *testing.T) {
	h := validationHandler()
	req := httptest.NewRequest("POST", "/_seam/procedure/greet", strings.NewReader(`{"name": 42}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	errObj := resp["error"].(map[string]any)
	if errObj["code"] != "VALIDATION_ERROR" {
		t.Fatalf("expected VALIDATION_ERROR, got %v", errObj["code"])
	}
	msg := errObj["message"].(string)
	if !strings.Contains(msg, "Input validation failed") {
		t.Fatalf("unexpected message: %s", msg)
	}
	details, ok := errObj["details"].([]any)
	if !ok || len(details) == 0 {
		t.Fatal("expected non-empty details array")
	}
	detail := details[0].(map[string]any)
	if detail["path"] != "/name" {
		t.Fatalf("expected path /name, got %v", detail["path"])
	}
	if detail["expected"] != "string" {
		t.Fatalf("expected type string, got %v", detail["expected"])
	}
}

func TestValidationAcceptsValidInput(t *testing.T) {
	h := validationHandler()
	req := httptest.NewRequest("POST", "/_seam/procedure/greet", strings.NewReader(`{"name": "Seam"}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestValidationBatchOneInvalid(t *testing.T) {
	// Go batch requires rpcHashMap; use hash map with batch hash "_batch"
	hashMap := &RpcHashMap{Batch: "_batch", Procedures: map[string]string{"greet": "greet"}}
	h := buildHandler(
		[]ProcedureDef{{
			Name:        "greet",
			InputSchema: map[string]any{"properties": map[string]any{"name": map[string]any{"type": "string"}}},
			Handler:     echoHandler(),
		}},
		nil, nil, nil, nil, nil, hashMap, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeAlways,
	)
	body := `{"calls":[{"procedure":"greet","input":{"name":42}},{"procedure":"greet","input":{"name":"OK"}}]}`
	req := httptest.NewRequest("POST", "/_seam/procedure/_batch", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	results := resp["data"].(map[string]any)["results"].([]any)
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	// First call fails validation
	r0 := results[0].(map[string]any)
	if r0["ok"] != false {
		t.Fatal("expected first call to fail")
	}
	errObj := r0["error"].(map[string]any)
	if errObj["code"] != "VALIDATION_ERROR" {
		t.Fatalf("expected VALIDATION_ERROR, got %v", errObj["code"])
	}
	// Second call succeeds
	r1 := results[1].(map[string]any)
	if r1["ok"] != true {
		t.Fatal("expected second call to succeed")
	}
}

func TestValidationNeverSkips(t *testing.T) {
	h := buildHandler(
		[]ProcedureDef{{
			Name:        "greet",
			InputSchema: map[string]any{"properties": map[string]any{"name": map[string]any{"type": "string"}}},
			Handler:     echoHandler(),
		}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)
	// Invalid input passes through when validation is disabled
	req := httptest.NewRequest("POST", "/_seam/procedure/greet", strings.NewReader(`{"name": 42}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with validation disabled, got %d: %s", w.Code, w.Body.String())
	}
}

func TestValidationErrorDetailsShape(t *testing.T) {
	h := validationHandler()
	req := httptest.NewRequest("POST", "/_seam/procedure/greet", strings.NewReader(`{"name": 42}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)

	// Verify exact shape matches three-端 format
	if resp["ok"] != false {
		t.Fatal("expected ok=false")
	}
	errObj := resp["error"].(map[string]any)
	if errObj["code"] != "VALIDATION_ERROR" {
		t.Fatal("expected VALIDATION_ERROR code")
	}
	if errObj["transient"] != false {
		t.Fatal("expected transient=false")
	}
	details := errObj["details"].([]any)
	detail := details[0].(map[string]any)
	if _, ok := detail["path"]; !ok {
		t.Fatal("detail missing path field")
	}
	if _, ok := detail["expected"]; !ok {
		t.Fatal("detail missing expected field")
	}
	if _, ok := detail["actual"]; !ok {
		t.Fatal("detail missing actual field")
	}
}

func TestManifestSuppressPropagated(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{
			Name:     "warned",
			Handler:  echoHandler(),
			Suppress: []string{"unused"},
		}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/_seam/manifest.json", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	procs := m["procedures"].(map[string]any)
	warned := procs["warned"].(map[string]any)
	suppress := warned["suppress"].([]any)
	if len(suppress) != 1 || suppress[0] != "unused" {
		t.Fatalf("expected suppress=[\"unused\"], got %v", suppress)
	}
}

func TestManifestSuppressOmitted(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{Name: "clean", Handler: echoHandler()}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/_seam/manifest.json", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	procs := m["procedures"].(map[string]any)
	clean := procs["clean"].(map[string]any)
	if _, ok := clean["suppress"]; ok {
		t.Fatal("expected suppress to be omitted when nil")
	}
}

func TestManifestCacheTTL(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{
			Name:    "cached",
			Handler: echoHandler(),
			Cache:   map[string]any{"ttl": 30},
		}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/_seam/manifest.json", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	procs := m["procedures"].(map[string]any)
	cached := procs["cached"].(map[string]any)
	cache := cached["cache"].(map[string]any)
	if cache["ttl"] != float64(30) {
		t.Fatalf("expected cache.ttl=30, got %v", cache["ttl"])
	}
}

func TestManifestCacheFalse(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{
			Name:    "nocache",
			Handler: echoHandler(),
			Cache:   false,
		}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/_seam/manifest.json", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	procs := m["procedures"].(map[string]any)
	nocache := procs["nocache"].(map[string]any)
	if nocache["cache"] != false {
		t.Fatalf("expected cache=false, got %v", nocache["cache"])
	}
}

func TestManifestCacheOmitted(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{Name: "default", Handler: echoHandler()}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/_seam/manifest.json", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	procs := m["procedures"].(map[string]any)
	def := procs["default"].(map[string]any)
	if _, ok := def["cache"]; ok {
		t.Fatal("expected cache to be omitted when nil")
	}
}

func TestSSEZeroIdleTimeout(t *testing.T) {
	// With zero idle timeout, channel close triggers complete normally.
	subHandler := func(ctx context.Context, input json.RawMessage) (<-chan SubscriptionEvent, error) {
		ch := make(chan SubscriptionEvent, 1)
		ch <- SubscriptionEvent{Value: "hello"}
		close(ch)
		return ch, nil
	}

	handler := buildHandler(
		nil,
		[]SubscriptionDef{{Name: "no-idle", Handler: subHandler}},
		nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{SSEIdleTimeout: 0, HeartbeatInterval: 1 * time.Second}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/_seam/procedure/no-idle", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()
	if !strings.Contains(body, "event: data") {
		t.Fatalf("expected data event, got: %s", body)
	}
	if !strings.Contains(body, "event: complete") {
		t.Fatalf("expected complete event, got: %s", body)
	}
}

func TestPublicFileServing(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "favicon.svg"), []byte("<svg/>"), 0644)
	os.MkdirAll(filepath.Join(dir, "images"), 0755)
	os.WriteFile(filepath.Join(dir, "images", "logo.png"), []byte("png"), 0644)

	handler := buildHandler(
		[]ProcedureDef{{Name: "test", Handler: echoHandler()}},
		nil, nil, nil, nil, nil, nil, nil, dir, nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)

	// Serves file at root path
	req := httptest.NewRequest("GET", "/favicon.svg", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for favicon.svg, got %d", w.Code)
	}
	if !strings.Contains(w.Header().Get("Cache-Control"), "max-age=3600") {
		t.Fatalf("expected public cache, got %s", w.Header().Get("Cache-Control"))
	}

	// Serves nested file
	req = httptest.NewRequest("GET", "/images/logo.png", http.NoBody)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for nested file, got %d", w.Code)
	}

	// Falls through to mux for missing file
	req = httptest.NewRequest("GET", "/nonexistent.txt", http.NoBody)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code == http.StatusOK {
		t.Fatal("expected non-200 for missing file")
	}

	// /_seam/* routes still take priority
	req = httptest.NewRequest("GET", "/_seam/manifest.json", http.NoBody)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for manifest, got %d", w.Code)
	}

	// Path traversal blocked
	req = httptest.NewRequest("GET", "/../etc/passwd", http.NoBody)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code == http.StatusOK {
		t.Fatal("expected path traversal to be blocked")
	}
}

func TestPublicFilDisabled(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{Name: "test", Handler: echoHandler()}},
		nil, nil, nil, nil, nil, nil, nil, "", nil, nil,
		HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/favicon.svg", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	// Without publicDir, non-/_seam/ routes go to default mux (404)
	if w.Code == http.StatusOK {
		t.Fatal("expected non-200 without publicDir")
	}
}
