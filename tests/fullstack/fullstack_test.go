/* tests/fullstack/fullstack_test.go */

package fullstack

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
	"regexp"
	"strings"
	"testing"
	"time"
)

var baseURL string
var dataID = "__data"

var rpcHashMap struct {
	Procedures map[string]string `json:"procedures"`
	Batch      string            `json:"batch"`
}

func projectRoot() string {
	abs, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		panic(err)
	}
	return abs
}

func TestMain(m *testing.M) {
	root := projectRoot()
	exampleDir := filepath.Join(root, "examples", "github-dashboard", "seam-app")
	buildDir := filepath.Join(exampleDir, ".seam", "output")

	// Verify build output exists (seam build must have been run beforehand)
	if _, err := os.Stat(filepath.Join(buildDir, "route-manifest.json")); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "build output not found: run 'seam build' in the github-dashboard seam-app first")
		os.Exit(1)
	}

	// Load RPC hash map if present (obfuscation enabled)
	if data, err := os.ReadFile(filepath.Join(buildDir, "rpc-hash-map.json")); err == nil {
		if err := json.Unmarshal(data, &rpcHashMap); err != nil {
			fmt.Fprintf(os.Stderr, "failed to parse rpc-hash-map.json: %v\n", err)
			os.Exit(1)
		}
	}

	// Find a free port to avoid conflicts with other processes
	ln, err := net.Listen("tcp", ":0")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to find free port: %v\n", err)
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	// Start the server from the build output directory
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
	seamDataRe = regexp.MustCompile(`<script id="` + regexp.QuoteMeta(dataID) + `" type="application/json">(.+?)</script>`)

	// Health check: poll homepage (manifest may be 403 when obfuscated)
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

func getJSON(t *testing.T, url string) (status int, body map[string]any) {
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

func postJSON(t *testing.T, url string, payload any) (status int, body map[string]any) {
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

func getHTML(t *testing.T, url string) (status int, html string) {
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
	return resp.StatusCode, string(raw)
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

// rpcEndpoint returns the full URL for an RPC call, using hash map when obfuscation is active.
func rpcEndpoint(procedure string) string {
	if hash, ok := rpcHashMap.Procedures[procedure]; ok {
		return baseURL + "/_seam/procedure/" + hash
	}
	return baseURL + "/_seam/procedure/" + procedure
}

// extractData unwraps the { ok, data } envelope from a successful RPC response.
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

// -- Manifest tests --

func TestManifestEndpoint(t *testing.T) {
	t.Parallel()
	if rpcHashMap.Batch != "" {
		// Obfuscation active: manifest endpoint returns 403
		resp, err := http.Get(baseURL + "/_seam/manifest.json")
		if err != nil {
			t.Fatalf("GET manifest: %v", err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Fatalf("status = %d, want 403 (obfuscated)", resp.StatusCode)
		}
		return
	}

	status, body := getJSON(t, baseURL+"/_seam/manifest.json")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	version, ok := body["version"].(float64)
	if !ok {
		t.Fatalf("version not a number: %v", body["version"])
	}
	if version != 1 {
		t.Errorf("version = %v, want 1", version)
	}

	procs, ok := body["procedures"].(map[string]any)
	if !ok {
		t.Fatalf("procedures not an object: %T", body["procedures"])
	}

	expected := []string{"getHomeData", "getUser", "getUserRepos"}
	for _, name := range expected {
		if _, exists := procs[name]; !exists {
			t.Errorf("missing procedure %q in manifest", name)
		}
	}
}

// -- RPC tests --

func TestRPCQuery(t *testing.T) {
	t.Parallel()
	status, body := postJSON(t, rpcEndpoint("getUser"), map[string]any{
		"username": "octocat",
	})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	data := extractData(t, body)
	if _, ok := data["login"]; !ok {
		t.Error("response missing 'login' field")
	}
	if _, ok := data["avatar_url"]; !ok {
		t.Error("response missing 'avatar_url' field")
	}
}

func TestRPCNotFound(t *testing.T) {
	t.Parallel()
	status, body := postJSON(t, baseURL+"/_seam/procedure/deadbeefcafe", map[string]any{})
	if status != 404 {
		t.Fatalf("status = %d, want 404", status)
	}
	assertErrorResponse(t, body, "NOT_FOUND")
}

func TestRPCInvalidBody(t *testing.T) {
	t.Parallel()
	resp, err := http.Post(rpcEndpoint("getHomeData"), "application/json", strings.NewReader("not json{"))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	assertErrorResponse(t, body, "VALIDATION_ERROR")
}
