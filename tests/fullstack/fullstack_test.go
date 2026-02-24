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
	ln.Close()

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

	// Health check: poll homepage (manifest may be 403 when obfuscated)
	ready := make(chan struct{})
	go func() {
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			resp, err := http.Get(baseURL + "/")
			if err == nil && resp.StatusCode == 200 {
				resp.Body.Close()
				close(ready)
				return
			}
			if resp != nil {
				resp.Body.Close()
			}
			time.Sleep(200 * time.Millisecond)
		}
	}()

	select {
	case <-ready:
	case <-time.After(15 * time.Second):
		fmt.Fprintln(os.Stderr, "server did not become ready within 15s")
		cmd.Process.Kill()
		cmd.Wait()
		os.Exit(1)
	}

	code := m.Run()
	cmd.Process.Kill()
	cmd.Wait()
	os.Exit(code)
}

// -- Helpers --

func getJSON(t *testing.T, url string) (int, map[string]any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
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

func postJSON(t *testing.T, url string, payload any) (int, map[string]any) {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
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

func getHTML(t *testing.T, url string) (int, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
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
		return baseURL + "/_seam/rpc/" + hash
	}
	return baseURL + "/_seam/rpc/" + procedure
}

// -- Manifest tests --

func TestManifestEndpoint(t *testing.T) {
	if rpcHashMap.Batch != "" {
		// Obfuscation active: manifest endpoint returns 403
		resp, err := http.Get(baseURL + "/_seam/manifest.json")
		if err != nil {
			t.Fatalf("GET manifest: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Fatalf("status = %d, want 403 (obfuscated)", resp.StatusCode)
		}
		return
	}

	status, body := getJSON(t, baseURL+"/_seam/manifest.json")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	version, ok := body["version"].(string)
	if !ok || version == "" {
		t.Errorf("missing or empty version field")
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
	status, body := postJSON(t, rpcEndpoint("getUser"), map[string]any{
		"username": "octocat",
	})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	if _, ok := body["login"]; !ok {
		t.Error("response missing 'login' field")
	}
	if _, ok := body["avatar_url"]; !ok {
		t.Error("response missing 'avatar_url' field")
	}
}

func TestRPCNotFound(t *testing.T) {
	status, body := postJSON(t, baseURL+"/_seam/rpc/deadbeef", map[string]any{})
	if status != 404 {
		t.Fatalf("status = %d, want 404", status)
	}
	assertErrorResponse(t, body, "NOT_FOUND")
}

func TestRPCInvalidBody(t *testing.T) {
	resp, err := http.Post(rpcEndpoint("getHomeData"), "application/json", strings.NewReader("not json{"))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
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

// -- Page rendering tests --

var seamDataRe = regexp.MustCompile(`<script id="__SEAM_DATA__" type="application/json">(.+?)</script>`)

func assertPageHTML(t *testing.T, path string) string {
	t.Helper()
	status, html := getHTML(t, baseURL+path)
	if status != 200 {
		t.Fatalf("GET %s: status = %d, want 200", path, status)
	}

	if !strings.Contains(html, "__SEAM_ROOT__") {
		t.Errorf("HTML missing __SEAM_ROOT__")
	}
	if !strings.Contains(html, "__SEAM_DATA__") {
		t.Errorf("HTML missing __SEAM_DATA__")
	}
	// No unresolved seam markers should remain
	if strings.Contains(html, "<!--seam:") {
		idx := strings.Index(html, "<!--seam:")
		end := idx + 60
		if end > len(html) {
			end = len(html)
		}
		t.Errorf("HTML contains unresolved seam marker at byte %d: %s", idx, html[idx:end])
	}

	return html
}

func TestPageHome(t *testing.T) {
	assertPageHTML(t, "/_seam/page/")
}

func TestPageDashboard(t *testing.T) {
	html := assertPageHTML(t, "/_seam/page/dashboard/octocat")

	// Verify real GitHub data was injected
	if !strings.Contains(html, "octocat") {
		t.Error("dashboard HTML missing 'octocat' username")
	}
}

// -- Static asset tests --

func TestStaticAsset(t *testing.T) {
	_, html := getHTML(t, baseURL+"/_seam/page/")

	assetRe := regexp.MustCompile(`/_seam/static/[^"'\s]+`)
	matches := assetRe.FindAllString(html, -1)
	if len(matches) == 0 {
		t.Skip("no static asset URLs found in page HTML")
	}

	assetURL := baseURL + matches[0]
	resp, err := http.Get(assetURL)
	if err != nil {
		t.Fatalf("GET %s: %v", assetURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("asset status = %d, want 200", resp.StatusCode)
	}

	cc := resp.Header.Get("Cache-Control")
	if !strings.Contains(cc, "immutable") {
		t.Errorf("Cache-Control = %q, want 'immutable'", cc)
	}
}
