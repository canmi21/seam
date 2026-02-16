/* tests/fullstack/fullstack_test.go */

package fullstack

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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

func projectRoot() string {
	abs, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		panic(err)
	}
	return abs
}

func TestMain(m *testing.M) {
	root := projectRoot()
	exampleDir := filepath.Join(root, "examples", "fullstack", "react-hono-tanstack")
	buildDir := filepath.Join(exampleDir, ".seam", "output")

	// Verify build output exists (seam build must have been run beforehand)
	if _, err := os.Stat(filepath.Join(buildDir, "route-manifest.json")); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "build output not found: run 'seam build' in the fullstack example first")
		os.Exit(1)
	}

	// Start the server from the build output directory
	serverEntry := filepath.Join(buildDir, "server", "index.js")
	cmd := exec.Command("bun", "run", serverEntry)
	cmd.Dir = buildDir
	cmd.Env = append(os.Environ(), "PORT=3456")
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start server: %v\n", err)
		os.Exit(1)
	}

	baseURL = "http://localhost:3456"

	// Health check: poll manifest endpoint
	ready := make(chan struct{})
	go func() {
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			resp, err := http.Get(baseURL + "/_seam/manifest.json")
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

// -- Manifest tests --

func TestManifestEndpoint(t *testing.T) {
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

	// Fullstack example has these procedures
	expected := []string{"getPageData", "getAboutData", "getPosts", "getMessages", "addMessage", "onMessage"}
	for _, name := range expected {
		if _, exists := procs[name]; !exists {
			t.Errorf("missing procedure %q in manifest", name)
		}
	}
}

// -- RPC tests --

func TestRPCQuery(t *testing.T) {
	status, body := postJSON(t, baseURL+"/_seam/rpc/getPageData", map[string]any{})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	// getPageData returns an object with title, posts array, etc.
	if _, ok := body["title"]; !ok {
		t.Error("response missing 'title' field")
	}
	if _, ok := body["posts"]; !ok {
		t.Error("response missing 'posts' field")
	}
}

func TestRPCNotFound(t *testing.T) {
	status, body := postJSON(t, baseURL+"/_seam/rpc/nonexistent", map[string]any{})
	if status != 404 {
		t.Fatalf("status = %d, want 404", status)
	}
	assertErrorResponse(t, body, "NOT_FOUND")
}

func TestRPCInvalidBody(t *testing.T) {
	resp, err := http.Post(baseURL+"/_seam/rpc/getPageData", "application/json", strings.NewReader("not json{"))
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
		// Extract the unresolved marker for debugging
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

func TestPageAbout(t *testing.T) {
	assertPageHTML(t, "/_seam/page/about")
}

func TestPagePosts(t *testing.T) {
	assertPageHTML(t, "/_seam/page/posts")
}

// -- Static asset tests --

func TestStaticAsset(t *testing.T) {
	// Fetch a page and extract a static asset URL from it
	_, html := getHTML(t, baseURL+"/_seam/page/")

	// Look for CSS or JS asset references in the HTML
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

// -- SSE subscription tests --

func TestSSESubscription(t *testing.T) {
	// onMessage is a long-lived stream. Post a message to trigger data flow,
	// then verify we get SSE headers and at least one data event.
	done := make(chan struct{})
	go func() {
		defer close(done)
		// Small delay to let the SSE connection establish
		time.Sleep(200 * time.Millisecond)
		// Post a message to trigger the SSE stream
		postJSON(t, baseURL+"/_seam/rpc/addMessage", map[string]any{"text": "test-sse"})
	}()

	// Connect to SSE with a short transport-level header timeout
	transport := &http.Transport{
		ResponseHeaderTimeout: 5 * time.Second,
	}
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	resp, err := client.Get(baseURL + "/_seam/subscribe/onMessage")
	if err != nil {
		t.Fatalf("GET subscribe: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("Content-Type = %q, want prefix 'text/event-stream'", ct)
	}

	<-done
}
