/* src/server/core/go/state_test.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHandlerUses8SecondHeartbeatAnd12SecondIdleTimeoutByDefault(t *testing.T) {
	if defaultHandlerOptions.HeartbeatInterval != 8*time.Second {
		t.Fatalf("expected default heartbeat interval to be 8s, got %s", defaultHandlerOptions.HeartbeatInterval)
	}
	if defaultHandlerOptions.SSEIdleTimeout != 12*time.Second {
		t.Fatalf("expected default SSE idle timeout to be 12s, got %s", defaultHandlerOptions.SSEIdleTimeout)
	}
}

type testAppState struct {
	Prefix string
}

func TestRouterStateQueryAndCommand(t *testing.T) {
	state := &testAppState{Prefix: "shared"}
	router := NewRouter().
		State(state).
		Procedure(Query("getState", func(ctx context.Context, _ struct{}) (map[string]string, error) {
			s, ok := StateValue[*testAppState](ctx)
			if !ok {
				return nil, InternalError("missing state")
			}
			return map[string]string{"value": s.Prefix}, nil
		})).
		Procedure(Command("setState", func(ctx context.Context, _ struct{}) (map[string]string, error) {
			s, ok := StateValue[*testAppState](ctx)
			if !ok {
				return nil, InternalError("missing state")
			}
			return map[string]string{"value": s.Prefix}, nil
		}))

	handler := router.Handler()

	for _, tc := range []struct {
		name string
		path string
	}{
		{name: "query", path: "/_seam/procedure/getState"},
		{name: "command", path: "/_seam/procedure/setState"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(`{}`))
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}
			var resp map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &resp)
			data := resp["data"].(map[string]any)
			if data["value"] != "shared" {
				t.Fatalf("expected shared value, got %v", data["value"])
			}
		})
	}
}

func TestRouterStateWithContext(t *testing.T) {
	state := &testAppState{Prefix: "engine"}
	router := NewRouter().
		State(state).
		Context("token", ContextConfig{Extract: "header:authorization"}).
		Procedure(Query("getSecureState", func(ctx context.Context, _ struct{}) (map[string]string, error) {
			s, ok := StateValue[*testAppState](ctx)
			if !ok {
				return nil, InternalError("missing state")
			}
			token, ok := ContextValue[string](ctx, "token")
			if !ok {
				return nil, UnauthorizedError("missing token")
			}
			return map[string]string{"value": s.Prefix + ":" + token}, nil
		}, WithProcedureContext("token")))

	req := httptest.NewRequest(http.MethodPost, "/_seam/procedure/getSecureState", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer test")
	w := httptest.NewRecorder()
	router.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["value"] != "engine:Bearer test" {
		t.Fatalf("expected combined value, got %v", data["value"])
	}
}

func TestRouterStateBatchUsesSameInstance(t *testing.T) {
	state := &testAppState{Prefix: "shared"}
	router := NewRouter().
		State(state).
		RpcHashMap(&RpcHashMap{
			Batch:      "_batch",
			Procedures: map[string]string{"getA": "getA", "getB": "getB"},
		}).
		Procedure(Query("getA", func(ctx context.Context, _ struct{}) (map[string]string, error) {
			s, _ := StateValue[*testAppState](ctx)
			return map[string]string{"ptr": fmt.Sprintf("%p", s)}, nil
		})).
		Procedure(Query("getB", func(ctx context.Context, _ struct{}) (map[string]string, error) {
			s, _ := StateValue[*testAppState](ctx)
			return map[string]string{"ptr": fmt.Sprintf("%p", s)}, nil
		}))

	req := httptest.NewRequest(
		http.MethodPost,
		"/_seam/procedure/_batch",
		strings.NewReader(`{"calls":[{"procedure":"getA","input":{}},{"procedure":"getB","input":{}}]}`),
	)
	w := httptest.NewRecorder()
	router.Handler().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	results := resp["data"].(map[string]any)["results"].([]any)
	ptrA := results[0].(map[string]any)["data"].(map[string]any)["ptr"]
	ptrB := results[1].(map[string]any)["data"].(map[string]any)["ptr"]
	if ptrA != ptrB || ptrA != fmt.Sprintf("%p", state) {
		t.Fatalf("expected same state pointer, got %v and %v", ptrA, ptrB)
	}
}

func TestRouterStateSubscriptionStreamUploadAndPage(t *testing.T) {
	state := &testAppState{Prefix: "shared"}
	router := NewRouter().
		State(state).
		Procedure(Query("getPageData", func(ctx context.Context, _ struct{}) (map[string]string, error) {
			s, _ := StateValue[*testAppState](ctx)
			return map[string]string{"value": s.Prefix}, nil
		})).
		Subscription(&SubscriptionDef{
			Name: "onState",
			Handler: func(ctx context.Context, _ json.RawMessage) (<-chan SubscriptionEvent, error) {
				s, _ := StateValue[*testAppState](ctx)
				ch := make(chan SubscriptionEvent, 1)
				ch <- SubscriptionEvent{Value: map[string]string{"value": s.Prefix}}
				close(ch)
				return ch, nil
			},
		}).
		Stream(&StreamDef{
			Name: "streamState",
			Handler: func(ctx context.Context, _ json.RawMessage) (<-chan StreamEvent, error) {
				s, _ := StateValue[*testAppState](ctx)
				ch := make(chan StreamEvent, 1)
				ch <- StreamEvent{Value: map[string]string{"value": s.Prefix}}
				close(ch)
				return ch, nil
			},
		}).
		Upload(&UploadDef{
			Name: "uploadState",
			Handler: func(ctx context.Context, _ json.RawMessage, _ *SeamFileHandle) (any, error) {
				s, _ := StateValue[*testAppState](ctx)
				return map[string]string{"value": s.Prefix}, nil
			},
		}).
		Page(&PageDef{
			Route:    "/state",
			Template: "<html><body><!--seam:value--></body></html>",
			Loaders: []LoaderDef{{
				DataKey:   "value",
				Procedure: "getPageData",
				InputFn:   func(params map[string]string) any { return map[string]any{} },
			}},
		})

	handler := router.Handler()

	t.Run("subscription", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_seam/procedure/onState?input={}", http.NoBody)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		body := w.Body.String()
		if !strings.Contains(body, `"value":"shared"`) {
			t.Fatalf("expected state value in subscription body, got %s", body)
		}
	})

	t.Run("stream", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_seam/procedure/streamState", strings.NewReader(`{}`))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		body := w.Body.String()
		if !strings.Contains(body, `"value":"shared"`) {
			t.Fatalf("expected state value in stream body, got %s", body)
		}
	})

	t.Run("upload", func(t *testing.T) {
		var body strings.Builder
		writer := multipart.NewWriter(&body)
		if err := writer.WriteField("metadata", `{}`); err != nil {
			t.Fatal(err)
		}
		part, err := writer.CreateFormFile("file", "test.txt")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte("hello")); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}

		req := httptest.NewRequest(http.MethodPost, "/_seam/procedure/uploadState", strings.NewReader(body.String()))
		req.Header.Set("Content-Type", writer.FormDataContentType())
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var resp map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		data := resp["data"].(map[string]any)
		if data["value"] != "shared" {
			t.Fatalf("expected upload state value, got %v", data["value"])
		}
	})

	t.Run("page loader", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_seam/page/state", http.NoBody)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "shared") {
			t.Fatalf("expected rendered page to contain state value, got %s", w.Body.String())
		}
	})
}
