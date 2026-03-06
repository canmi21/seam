/* tests/fs-router/fs_router_test.go */

package fsrouter

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
var dataID = "__data"

func projectRoot() string {
	abs, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		panic(err)
	}
	return abs
}

func TestMain(m *testing.M) {
	root := projectRoot()
	exampleDir := filepath.Join(root, "examples", "fs-router-demo")
	buildDir := filepath.Join(exampleDir, ".seam", "output")

	if _, err := os.Stat(filepath.Join(buildDir, "route-manifest.json")); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "build output not found: run 'seam build' in examples/fs-router-demo first")
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

	ready := make(chan bool)
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

func getHTML(t *testing.T, url string) (status int, body string) {
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

func getJSON(t *testing.T, url string) (code int, body map[string]any) {
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

func postJSON(t *testing.T, url string, payload any) (code int, respBody map[string]any) {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
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

func assertPageHTML(t *testing.T, path string) string {
	t.Helper()
	status, html := getHTML(t, baseURL+path)
	if status != 200 {
		t.Fatalf("GET %s: status = %d, want 200", path, status)
	}
	if !strings.Contains(html, "__seam") {
		t.Errorf("HTML missing __seam root")
	}
	if !strings.Contains(html, dataID) {
		t.Errorf("HTML missing data ID %s", dataID)
	}
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

// -- Page rendering tests --

func TestHomePage(t *testing.T) {
	html := assertPageHTML(t, "/_seam/page/")
	if !strings.Contains(html, "FS Router Demo") {
		t.Error("home page HTML missing 'FS Router Demo'")
	}
}

func TestAboutPage(t *testing.T) {
	html := assertPageHTML(t, "/_seam/page/about")
	if !strings.Contains(html, "About") {
		t.Error("about page HTML missing 'About'")
	}
}

func TestBlogParam(t *testing.T) {
	html := assertPageHTML(t, "/_seam/page/blog/hello-world")
	// Skeleton renders with mock data; runtime injects real procedure data as JSON
	if !strings.Contains(html, "Hello World") && !strings.Contains(html, "hello-world") {
		t.Error("blog page HTML missing blog post content")
	}
}

func TestMarketingPricing(t *testing.T) {
	html := assertPageHTML(t, "/_seam/page/pricing")
	if !strings.Contains(html, "Pricing") {
		t.Error("pricing page HTML missing 'Pricing'")
	}
}

func TestMarketingFeatures(t *testing.T) {
	html := assertPageHTML(t, "/_seam/page/features")
	if !strings.Contains(html, "Features") {
		t.Error("features page HTML missing 'Features'")
	}
}

func TestDocsCatchAll(t *testing.T) {
	html := assertPageHTML(t, "/_seam/page/docs/getting-started")
	if !strings.Contains(html, "Documentation") {
		t.Error("docs page HTML missing 'Documentation'")
	}
}

func TestDocsRoot(t *testing.T) {
	html := assertPageHTML(t, "/_seam/page/docs")
	if !strings.Contains(html, "Documentation") {
		t.Error("docs root page HTML missing 'Documentation'")
	}
}

func TestRootLayoutPresent(t *testing.T) {
	_, html := getHTML(t, baseURL+"/_seam/page/")
	if !strings.Contains(html, `id="root-layout"`) {
		t.Error("home page HTML missing root-layout wrapper")
	}
}

func TestGroupLayoutPresent(t *testing.T) {
	_, html := getHTML(t, baseURL+"/_seam/page/pricing")
	if !strings.Contains(html, `id="marketing-layout"`) {
		t.Error("pricing page HTML missing marketing-layout wrapper")
	}
	// Marketing pages are also wrapped by root layout
	if !strings.Contains(html, `id="root-layout"`) {
		t.Error("pricing page HTML missing root-layout wrapper")
	}
}

// -- RPC tests --

func TestRPCQuery(t *testing.T) {
	status, body := postJSON(t, baseURL+"/_seam/procedure/getPageData", map[string]any{})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	title, _ := data["title"].(string)
	if title != "FS Router Demo" {
		t.Errorf("title = %q, want %q", title, "FS Router Demo")
	}
}

func TestRPCBlogPost(t *testing.T) {
	status, body := postJSON(t, baseURL+"/_seam/procedure/getBlogPost", map[string]any{
		"slug": "test-slug",
	})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	title, _ := data["title"].(string)
	if title != "Post: test-slug" {
		t.Errorf("title = %q, want %q", title, "Post: test-slug")
	}
	author, _ := data["author"].(string)
	if author != "Demo Author" {
		t.Errorf("author = %q, want %q", author, "Demo Author")
	}
}

func TestManifest(t *testing.T) {
	// Manifest is disabled when rpcHashMap is active (hides procedure names)
	status, _ := getJSON(t, baseURL+"/_seam/manifest.json")
	if status != 403 {
		t.Fatalf("status = %d, want 403 (manifest disabled with rpcHashMap)", status)
	}
}

// -- Error path tests --

func TestPageNotFound(t *testing.T) {
	status, _ := getHTML(t, baseURL+"/_seam/page/nonexistent")
	if status != 404 {
		t.Fatalf("status = %d, want 404", status)
	}
}

func TestRPCNotFound(t *testing.T) {
	status, body := postJSON(t, baseURL+"/_seam/procedure/nonexistent", map[string]any{})
	if status != 404 {
		t.Fatalf("status = %d, want 404", status)
	}
	assertErrorResponse(t, body, "NOT_FOUND")
}

func TestRPCInvalidBody(t *testing.T) {
	resp, err := http.Post(baseURL+"/_seam/procedure/getPageData", "application/json", strings.NewReader("not json{"))
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

func TestNoUnresolvedSlots(t *testing.T) {
	paths := []string{
		"/_seam/page/",
		"/_seam/page/about",
		"/_seam/page/pricing",
		"/_seam/page/features",
		"/_seam/page/docs",
	}
	for _, p := range paths {
		status, html := getHTML(t, baseURL+p)
		if status != 200 {
			t.Errorf("GET %s: status = %d, want 200", p, status)
			continue
		}
		for _, marker := range []string{"<!--seam:page-styles-->", "<!--seam:page-scripts-->", "<!--seam:prefetch-->"} {
			if strings.Contains(html, marker) {
				t.Errorf("GET %s: HTML contains unresolved slot marker: %s", p, marker)
			}
		}
	}
}
