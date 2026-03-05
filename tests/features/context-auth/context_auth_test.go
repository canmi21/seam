/* tests/features/context-auth/context_auth_test.go */

package context_auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var baseURL string

func projectRoot() string {
	abs, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		panic(err)
	}
	return abs
}

func TestMain(m *testing.M) {
	root := projectRoot()
	exampleDir := filepath.Join(root, "examples", "features", "context-auth")
	buildDir := filepath.Join(exampleDir, ".seam", "output")

	if _, err := os.Stat(filepath.Join(buildDir, "route-manifest.json")); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "build output not found: run 'seam build' in examples/features/context-auth first")
		os.Exit(1)
	}

	ln, err := net.Listen("tcp", ":0")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to find free port: %v\n", err)
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	serverEntry := filepath.Join(buildDir, "server", "index.js")
	cmd := exec.Command("bun", "run", serverEntry)
	cmd.Dir = buildDir
	cmd.Env = append(os.Environ(), fmt.Sprintf("PORT=%d", port))
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start server: %v\n", err)
		os.Exit(1)
	}

	baseURL = fmt.Sprintf("http://localhost:%d", port)

	ready := make(chan struct{})
	go func() {
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			resp, err := http.Get(baseURL + "/")
			if err == nil && resp.StatusCode == 200 {
				_ = resp.Body.Close()
				close(ready)
				return
			}
			if resp != nil {
				_ = resp.Body.Close()
			}
			time.Sleep(200 * time.Millisecond)
		}
	}()

	select {
	case <-ready:
	case <-time.After(15 * time.Second):
		fmt.Fprintln(os.Stderr, "server did not become ready within 15s")
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		os.Exit(1)
	}

	code := m.Run()
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	os.Exit(code)
}

// -- Helpers --

func rpcEndpoint(procedure string) string {
	return baseURL + "/_seam/procedure/" + procedure
}

func getJSON(t *testing.T, url string) (status int, data map[string]any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal response: %v\nbody: %s", err, raw)
	}
	return resp.StatusCode, m
}

func postJSON(t *testing.T, url string, payload any) (status int, data map[string]any) {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal response: %v\nbody: %s", err, raw)
	}
	return resp.StatusCode, m
}

// postJSONWithAuth sends a POST with a custom Authorization header.
func postJSONWithAuth(t *testing.T, url string, payload any, authHeader string) (status int, data map[string]any) {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	req, err := http.NewRequest("POST", url, bytes.NewReader(b))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal response: %v\nbody: %s", err, raw)
	}
	return resp.StatusCode, m
}

func extractData(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	if ok, _ := body["ok"].(bool); !ok {
		t.Fatalf("expected ok=true, got: %v", body)
	}
	data, exists := body["data"].(map[string]any)
	if !exists {
		t.Fatalf("expected data object in envelope, got: %v", body["data"])
	}
	return data
}

func assertErrorResponse(t *testing.T, body map[string]any, expectedCode string) {
	t.Helper()
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("expected error envelope, got: %v", body)
	}
	code, ok := errObj["code"].(string)
	if !ok {
		t.Fatalf("expected error.code string, got: %v", errObj["code"])
	}
	if code != expectedCode {
		t.Errorf("error.code = %q, want %q", code, expectedCode)
	}
}

// -- Manifest tests --

func TestManifestVersion(t *testing.T) {
	status, body := getJSON(t, baseURL+"/_seam/manifest.json")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	version, ok := body["version"].(float64)
	if !ok {
		t.Fatalf("version not a number: %v", body["version"])
	}
	if version != 2 {
		t.Errorf("version = %v, want 2", version)
	}
}

func TestManifestContext(t *testing.T) {
	_, body := getJSON(t, baseURL+"/_seam/manifest.json")
	ctx, ok := body["context"].(map[string]any)
	if !ok {
		t.Fatal("context not an object")
	}
	auth, ok := ctx["auth"].(map[string]any)
	if !ok {
		t.Fatal("context.auth not found")
	}
	if auth["extract"] != "header:authorization" {
		t.Errorf("auth.extract = %v, want header:authorization", auth["extract"])
	}
	if auth["schema"] == nil {
		t.Error("auth.schema missing")
	}
}

func TestManifestProcedureContextRefs(t *testing.T) {
	_, body := getJSON(t, baseURL+"/_seam/manifest.json")
	procs := body["procedures"].(map[string]any)

	secret := procs["getSecretData"].(map[string]any)
	ctxRefs, ok := secret["context"].([]any)
	if !ok {
		t.Fatal("getSecretData.context not an array")
	}
	if len(ctxRefs) != 1 || ctxRefs[0] != "auth" {
		t.Errorf("getSecretData.context = %v, want [auth]", ctxRefs)
	}

	pub := procs["getPublicInfo"].(map[string]any)
	if pub["context"] != nil {
		t.Errorf("getPublicInfo should have no context, got: %v", pub["context"])
	}
}

// -- Auth tests --

func TestPublicNoAuth(t *testing.T) {
	status, body := postJSON(t, rpcEndpoint("getPublicInfo"), map[string]any{})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	if data["message"] != "This is public" {
		t.Errorf("message = %v, want 'This is public'", data["message"])
	}
}

func TestSecretNoAuth(t *testing.T) {
	_, body := postJSON(t, rpcEndpoint("getSecretData"), map[string]any{})
	assertErrorResponse(t, body, "CONTEXT_ERROR")
}

func TestSecretWithAuth(t *testing.T) {
	authJSON, _ := json.Marshal(map[string]any{"userId": "alice", "role": "admin"})
	status, body := postJSONWithAuth(t, rpcEndpoint("getSecretData"), map[string]any{}, string(authJSON))
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	msg, _ := data["message"].(string)
	if !strings.Contains(msg, "Hello alice") {
		t.Errorf("message = %q, want to contain 'Hello alice'", msg)
	}
}

func TestCommandWithAuth(t *testing.T) {
	authJSON, _ := json.Marshal(map[string]any{"userId": "alice", "role": "admin"})
	status, body := postJSONWithAuth(t, rpcEndpoint("updateProfile"), map[string]any{"name": "Alice"}, string(authJSON))
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	if data["updatedBy"] != "alice" {
		t.Errorf("updatedBy = %v, want alice", data["updatedBy"])
	}
}

func TestCommandNoAuth(t *testing.T) {
	_, body := postJSON(t, rpcEndpoint("updateProfile"), map[string]any{"name": "Alice"})
	assertErrorResponse(t, body, "CONTEXT_ERROR")
}
