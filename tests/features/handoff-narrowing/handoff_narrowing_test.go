/* tests/features/handoff-narrowing/handoff_narrowing_test.go */

package handoff_narrowing

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
var buildDir string

func projectRoot() string {
	abs, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		panic(err)
	}
	return abs
}

func TestMain(m *testing.M) {
	root := projectRoot()
	exampleDir := filepath.Join(root, "examples", "features", "handoff-narrowing")
	buildDir = filepath.Join(exampleDir, ".seam", "output")

	if _, err := os.Stat(filepath.Join(buildDir, "route-manifest.json")); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "build output not found: run 'seam build' in examples/features/handoff-narrowing first")
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

// extractSeamData parses the __data JSON from the page HTML.
var seamDataRe = regexp.MustCompile(`<script id="__data" type="application/json">(.+?)</script>`)

func extractSeamData(t *testing.T, html string) map[string]any {
	t.Helper()
	matches := seamDataRe.FindStringSubmatch(html)
	if matches == nil {
		t.Fatal("__data script tag not found in HTML")
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(matches[1]), &data); err != nil {
		t.Fatalf("unmarshal __data: %v", err)
	}
	return data
}

// -- Page tests --

func TestPageRender(t *testing.T) {
	status, html := getHTML(t, baseURL+"/_seam/page/")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	if !strings.Contains(html, "__seam") {
		t.Error("HTML missing __seam")
	}
	if !strings.Contains(html, "__data") {
		t.Error("HTML missing __data")
	}
}

func TestPageDataNarrowed(t *testing.T) {
	_, html := getHTML(t, baseURL+"/_seam/page/")
	data := extractSeamData(t, html)

	profile, ok := data["profile"].(map[string]any)
	if !ok {
		t.Fatal("profile not found in __data")
	}

	// Narrowed: only name + avatar should be present
	if profile["name"] == nil {
		t.Error("profile missing name")
	}
	if profile["avatar"] == nil {
		t.Error("profile missing avatar")
	}

	// These fields should be pruned by narrowing
	for _, field := range []string{"email", "bio", "createdAt", "settings"} {
		if profile[field] != nil {
			t.Errorf("profile should not contain %q after narrowing, got: %v", field, profile[field])
		}
	}
}

func TestPageNoUnresolvedMarkers(t *testing.T) {
	_, html := getHTML(t, baseURL+"/_seam/page/")
	if strings.Contains(html, "<!--seam:") {
		idx := strings.Index(html, "<!--seam:")
		end := idx + 60
		if end > len(html) {
			end = len(html)
		}
		t.Errorf("HTML contains unresolved seam marker: %s", html[idx:end])
	}
}

// -- Route manifest tests (filesystem) --

func TestRouteManifestProjections(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(buildDir, "route-manifest.json"))
	if err != nil {
		t.Fatalf("read route-manifest.json: %v", err)
	}
	var manifest struct {
		Routes map[string]struct {
			Projections map[string][]string `json:"projections"`
		} `json:"routes"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	route, ok := manifest.Routes["/"]
	if !ok {
		t.Fatal("route / not found")
	}
	proj, ok := route.Projections["profile"]
	if !ok {
		t.Fatal("projections.profile not found")
	}

	expected := map[string]bool{"avatar": true, "name": true}
	if len(proj) != len(expected) {
		t.Fatalf("projections.profile = %v, want [avatar, name]", proj)
	}
	for _, field := range proj {
		if !expected[field] {
			t.Errorf("unexpected projection field: %q", field)
		}
	}
}

func TestRouteManifestHandoff(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(buildDir, "route-manifest.json"))
	if err != nil {
		t.Fatalf("read route-manifest.json: %v", err)
	}
	var manifest struct {
		Routes map[string]struct {
			Loaders map[string]struct {
				Handoff string `json:"handoff"`
			} `json:"loaders"`
		} `json:"routes"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	route, ok := manifest.Routes["/"]
	if !ok {
		t.Fatal("route / not found")
	}
	theme, ok := route.Loaders["theme"]
	if !ok {
		t.Fatal("loaders.theme not found")
	}
	if theme.Handoff != "client" {
		t.Errorf("theme.handoff = %q, want client", theme.Handoff)
	}
}

// -- RPC tests --

func TestRPCGetUserProfile(t *testing.T) {
	status, body := postJSON(t, rpcEndpoint("getUserProfile"), map[string]any{})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)

	// Full data should have all 6 fields (not narrowed via RPC)
	for _, field := range []string{"name", "email", "avatar", "bio", "createdAt", "settings"} {
		if data[field] == nil {
			t.Errorf("getUserProfile response missing %q", field)
		}
	}
}

func TestRPCGetUserTheme(t *testing.T) {
	status, body := postJSON(t, rpcEndpoint("getUserTheme"), map[string]any{})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	if data["mode"] != "light" {
		t.Errorf("mode = %v, want light", data["mode"])
	}
}
