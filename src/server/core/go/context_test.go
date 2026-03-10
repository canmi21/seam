/* src/server/core/go/context_test.go */

package seam

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestContextValueString(t *testing.T) {
	ctx := context.WithValue(context.Background(), seamContextKey, map[string]any{
		"token": "Bearer abc",
	})
	val, ok := ContextValue[string](ctx, "token")
	if !ok || val != "Bearer abc" {
		t.Fatalf("expected 'Bearer abc', got %q (ok=%v)", val, ok)
	}
}

func TestContextValueMissing(t *testing.T) {
	ctx := context.WithValue(context.Background(), seamContextKey, map[string]any{})
	_, ok := ContextValue[string](ctx, "token")
	if ok {
		t.Fatal("expected false for missing key")
	}
}

func TestContextValueNil(t *testing.T) {
	ctx := context.WithValue(context.Background(), seamContextKey, map[string]any{
		"token": nil,
	})
	_, ok := ContextValue[string](ctx, "token")
	if ok {
		t.Fatal("expected false for nil value")
	}
}

func TestContextValueNoContext(t *testing.T) {
	ctx := context.Background()
	_, ok := ContextValue[string](ctx, "token")
	if ok {
		t.Fatal("expected false when no seam context set")
	}
}

type testAuthCtx struct {
	Token  string `json:"token"`
	UserID string `json:"userId"`
}

func TestContextValueStruct(t *testing.T) {
	ctx := context.WithValue(context.Background(), seamContextKey, map[string]any{
		"auth": map[string]any{"token": "abc", "userId": "u1"},
	})
	val, ok := ContextValue[testAuthCtx](ctx, "auth")
	if !ok {
		t.Fatal("expected true for struct value")
	}
	if val.Token != "abc" || val.UserID != "u1" {
		t.Fatalf("expected {abc, u1}, got %+v", val)
	}
}

func TestParseExtractRule(t *testing.T) {
	source, key, ok := parseExtractRule("header:authorization")
	if !ok || source != "header" || key != "authorization" {
		t.Fatalf("expected (header, authorization), got (%s, %s, %v)", source, key, ok)
	}

	_, _, ok = parseExtractRule("no-colon")
	if ok {
		t.Fatal("expected false for invalid rule")
	}
}

func TestRPCWithContextHeader(t *testing.T) {
	ctxConfigs := map[string]ContextConfig{
		"token": {Extract: "header:authorization"},
	}

	proc := ProcedureDef{
		Name:        "getSecret",
		ContextKeys: []string{"token"},
		Handler: func(ctx context.Context, input json.RawMessage) (any, error) {
			token, ok := ContextValue[string](ctx, "token")
			if !ok {
				return nil, UnauthorizedError("no token")
			}
			return map[string]string{"token": token}, nil
		},
	}

	handler := buildHandler(
		[]ProcedureDef{proc},
		nil, nil, nil, nil, nil, nil, nil, "", nil, ctxConfigs,
		HandlerOptions{}, ValidationModeNever,
	)

	req := httptest.NewRequest("POST", "/_seam/procedure/getSecret", strings.NewReader("{}"))
	req.Header.Set("Authorization", "Bearer test123")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["token"] != "Bearer test123" {
		t.Fatalf("expected 'Bearer test123', got %v", data["token"])
	}
}

func TestRPCWithContextCookie(t *testing.T) {
	ctxConfigs := map[string]ContextConfig{
		"session": {Extract: "cookie:session_id"},
	}

	proc := ProcedureDef{
		Name:        "getSession",
		ContextKeys: []string{"session"},
		Handler: func(ctx context.Context, input json.RawMessage) (any, error) {
			session, ok := ContextValue[string](ctx, "session")
			if !ok {
				return map[string]bool{"hasSession": false}, nil
			}
			return map[string]string{"session": session}, nil
		},
	}

	handler := buildHandler(
		[]ProcedureDef{proc},
		nil, nil, nil, nil, nil, nil, nil, "", nil, ctxConfigs,
		HandlerOptions{}, ValidationModeNever,
	)

	req := httptest.NewRequest("POST", "/_seam/procedure/getSession", strings.NewReader("{}"))
	req.AddCookie(&http.Cookie{Name: "session_id", Value: "abc123"})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["session"] != "abc123" {
		t.Fatalf("expected 'abc123', got %v", data["session"])
	}
}

func TestRPCWithContextQuery(t *testing.T) {
	ctxConfigs := map[string]ContextConfig{
		"lang": {Extract: "query:lang"},
	}

	proc := ProcedureDef{
		Name:        "getLang",
		ContextKeys: []string{"lang"},
		Handler: func(ctx context.Context, input json.RawMessage) (any, error) {
			lang, ok := ContextValue[string](ctx, "lang")
			if !ok {
				return map[string]bool{"hasLang": false}, nil
			}
			return map[string]string{"lang": lang}, nil
		},
	}

	handler := buildHandler(
		[]ProcedureDef{proc},
		nil, nil, nil, nil, nil, nil, nil, "", nil, ctxConfigs,
		HandlerOptions{}, ValidationModeNever,
	)

	req := httptest.NewRequest("POST", "/_seam/procedure/getLang?lang=en", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["lang"] != "en" {
		t.Fatalf("expected 'en', got %v", data["lang"])
	}
}

func TestRPCMissingCookie(t *testing.T) {
	ctxConfigs := map[string]ContextConfig{
		"session": {Extract: "cookie:session_id"},
	}

	proc := ProcedureDef{
		Name:        "getSession",
		ContextKeys: []string{"session"},
		Handler: func(ctx context.Context, input json.RawMessage) (any, error) {
			_, ok := ContextValue[string](ctx, "session")
			return map[string]bool{"hasSession": ok}, nil
		},
	}

	handler := buildHandler(
		[]ProcedureDef{proc},
		nil, nil, nil, nil, nil, nil, nil, "", nil, ctxConfigs,
		HandlerOptions{}, ValidationModeNever,
	)

	req := httptest.NewRequest("POST", "/_seam/procedure/getSession", strings.NewReader("{}"))
	// No cookie
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["hasSession"] != false {
		t.Fatalf("expected hasSession=false, got %v", data["hasSession"])
	}
}

func TestRPCMissingQuery(t *testing.T) {
	ctxConfigs := map[string]ContextConfig{
		"lang": {Extract: "query:lang"},
	}

	proc := ProcedureDef{
		Name:        "getLang",
		ContextKeys: []string{"lang"},
		Handler: func(ctx context.Context, input json.RawMessage) (any, error) {
			_, ok := ContextValue[string](ctx, "lang")
			return map[string]bool{"hasLang": ok}, nil
		},
	}

	handler := buildHandler(
		[]ProcedureDef{proc},
		nil, nil, nil, nil, nil, nil, nil, "", nil, ctxConfigs,
		HandlerOptions{}, ValidationModeNever,
	)

	req := httptest.NewRequest("POST", "/_seam/procedure/getLang", strings.NewReader("{}"))
	// No query param
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["hasLang"] != false {
		t.Fatalf("expected hasLang=false, got %v", data["hasLang"])
	}
}

func TestRPCMissingContextPassesNil(t *testing.T) {
	ctxConfigs := map[string]ContextConfig{
		"token": {Extract: "header:authorization"},
	}

	proc := ProcedureDef{
		Name:        "getSecret",
		ContextKeys: []string{"token"},
		Handler: func(ctx context.Context, input json.RawMessage) (any, error) {
			_, ok := ContextValue[string](ctx, "token")
			return map[string]bool{"hasToken": ok}, nil
		},
	}

	handler := buildHandler(
		[]ProcedureDef{proc},
		nil, nil, nil, nil, nil, nil, nil, "", nil, ctxConfigs,
		HandlerOptions{}, ValidationModeNever,
	)

	req := httptest.NewRequest("POST", "/_seam/procedure/getSecret", strings.NewReader("{}"))
	// No Authorization header
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["hasToken"] != false {
		t.Fatalf("expected hasToken=false, got %v", data["hasToken"])
	}
}

func TestManifestIncludesContext(t *testing.T) {
	ctxConfigs := map[string]ContextConfig{
		"token": {Extract: "header:authorization"},
	}

	proc := ProcedureDef{
		Name:        "secure",
		ContextKeys: []string{"token"},
		Handler: func(ctx context.Context, input json.RawMessage) (any, error) {
			return nil, nil
		},
	}

	m := buildManifest([]ProcedureDef{proc}, nil, nil, nil, nil, ctxConfigs)
	b, _ := json.Marshal(m)
	var result map[string]any
	_ = json.Unmarshal(b, &result)

	// Check top-level context
	ctxField := result["context"].(map[string]any)
	tokenEntry := ctxField["token"].(map[string]any)
	if tokenEntry["extract"] != "header:authorization" {
		t.Fatalf("expected header:authorization, got %v", tokenEntry["extract"])
	}

	// Check procedure context keys
	procs := result["procedures"].(map[string]any)
	secureProc := procs["secure"].(map[string]any)
	procCtx := secureProc["context"].([]any)
	if len(procCtx) != 1 || procCtx[0] != "token" {
		t.Fatalf("expected [token], got %v", procCtx)
	}

	// Check transportDefaults exists
	if _, ok := result["transportDefaults"]; !ok {
		t.Fatal("expected transportDefaults field")
	}
}
