/* src/server/core/go/handler_test.go */

package seam

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
		nil, nil, nil, nil, nil, nil, nil, nil, nil,
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
		nil, nil, nil, nil, nil, nil, nil, nil, nil,
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
		nil, nil, nil, nil,
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
		nil, nil, nil, nil, nil, nil, nil, nil,
		HandlerOptions{SSEIdleTimeout: 50 * time.Millisecond}, ValidationModeNever,
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
		nil, nil, nil, nil, nil, nil, nil, nil, nil,
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
		nil, nil, nil, nil, nil, hashMap, nil, nil, nil,
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
		nil, nil, nil, nil, nil, nil, nil, nil, nil,
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
		nil, nil, nil, nil, nil, nil, nil, nil,
		HandlerOptions{SSEIdleTimeout: 0}, ValidationModeNever,
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
