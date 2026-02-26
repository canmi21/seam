/* packages/server/core/go/handler_test.go */

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
		nil, nil, nil, nil,
		HandlerOptions{RPCTimeout: 10 * time.Millisecond},
	)

	req := httptest.NewRequest("POST", "/_seam/rpc/slow", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d", w.Code)
	}

	var resp map[string]map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"]["message"] != "RPC timed out" {
		t.Fatalf("unexpected error message: %s", resp["error"]["message"])
	}
}

func TestRPCZeroTimeout(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{Name: "slow", Handler: slowHandler(50 * time.Millisecond)}},
		nil, nil, nil, nil,
		HandlerOptions{RPCTimeout: 0},
	)

	req := httptest.NewRequest("POST", "/_seam/rpc/slow", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with zero timeout, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPageTimeout(t *testing.T) {
	handler := buildHandler(
		[]ProcedureDef{{Name: "fetchData", Handler: slowHandler(100 * time.Millisecond)}},
		nil,
		[]PageDef{{
			Route:    "/test",
			Template: "<html>__SEAM_DATA__</html>",
			Loaders: []LoaderDef{{
				DataKey:   "data",
				Procedure: "fetchData",
				InputFn:   func(params map[string]string) any { return map[string]string{} },
			}},
		}},
		nil, nil,
		HandlerOptions{PageTimeout: 10 * time.Millisecond},
	)

	req := httptest.NewRequest("GET", "/_seam/page/test", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
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
		nil, nil, nil,
		HandlerOptions{SSEIdleTimeout: 50 * time.Millisecond},
	)

	req := httptest.NewRequest("GET", "/_seam/subscribe/idle-test", nil)
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
		nil, nil, nil,
		HandlerOptions{SSEIdleTimeout: 0},
	)

	req := httptest.NewRequest("GET", "/_seam/subscribe/no-idle", nil)
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
