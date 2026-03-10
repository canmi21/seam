/* src/server/core/go/handler_public_file_test.go */

package seam

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPublicFileServing(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "favicon.svg"), []byte("<svg/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "images"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "images", "logo.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	handler := buildHandler(
		[]ProcedureDef{{Name: "test", Handler: echoHandler()}},
		nil, nil, nil, nil, nil, nil, nil, dir, nil, nil,
		nil, HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/favicon.svg", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for favicon.svg, got %d", w.Code)
	}
	if body := w.Body.String(); body != "<svg/>" {
		t.Fatalf("expected raw favicon body, got %q", body)
	}
	if !strings.Contains(w.Header().Get("Cache-Control"), "max-age=3600") {
		t.Fatalf("expected public cache, got %s", w.Header().Get("Cache-Control"))
	}

	req = httptest.NewRequest("GET", "/images/logo.png", http.NoBody)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for nested file, got %d", w.Code)
	}
	if body := w.Body.String(); body != "png" {
		t.Fatalf("expected raw nested file body, got %q", body)
	}

	req = httptest.NewRequest("GET", "/nonexistent.txt", http.NoBody)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code == http.StatusOK {
		t.Fatal("expected non-200 for missing file")
	}

	req = httptest.NewRequest("GET", "/_seam/manifest.json", http.NoBody)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for manifest, got %d", w.Code)
	}

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
		nil, HandlerOptions{RPCTimeout: 30 * time.Second}, ValidationModeNever,
	)

	req := httptest.NewRequest("GET", "/favicon.svg", http.NoBody)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code == http.StatusOK {
		t.Fatal("expected non-200 without publicDir")
	}
}
