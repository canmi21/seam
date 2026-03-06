/* tests/features/query-mutation/query_mutation_test.go */

package query_mutation

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
	exampleDir := filepath.Join(root, "examples", "features", "query-mutation")
	buildDir := filepath.Join(exampleDir, ".seam", "output")

	if _, err := os.Stat(filepath.Join(buildDir, "route-manifest.json")); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "build output not found: run 'seam build' in examples/features/query-mutation first")
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

// -- Helpers: file-based manifest (blocked via HTTP when rpcHashMap is active) --

func loadManifest(t *testing.T) map[string]any {
	t.Helper()
	root := projectRoot()
	path := filepath.Join(root, "examples", "features", "query-mutation", ".seam", "output", "seam-manifest.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal manifest: %v", err)
	}
	return m
}

// -- Manifest tests --

func TestManifestCommandKind(t *testing.T) {
	body := loadManifest(t)
	procs := body["procedures"].(map[string]any)

	addTodo := procs["addTodo"].(map[string]any)
	if addTodo["kind"] != "command" {
		t.Errorf("addTodo.kind = %v, want command", addTodo["kind"])
	}
	toggleTodo := procs["toggleTodo"].(map[string]any)
	if toggleTodo["kind"] != "command" {
		t.Errorf("toggleTodo.kind = %v, want command", toggleTodo["kind"])
	}
}

func TestManifestInvalidatesSimple(t *testing.T) {
	body := loadManifest(t)
	procs := body["procedures"].(map[string]any)

	addTodo := procs["addTodo"].(map[string]any)
	invalidates, ok := addTodo["invalidates"].([]any)
	if !ok {
		t.Fatal("addTodo.invalidates not an array")
	}

	found := false
	for _, inv := range invalidates {
		obj, ok := inv.(map[string]any)
		if !ok {
			continue
		}
		if obj["query"] == "listTodos" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("addTodo.invalidates missing {query: listTodos}, got: %v", invalidates)
	}
}

func TestManifestInvalidatesMapping(t *testing.T) {
	body := loadManifest(t)
	procs := body["procedures"].(map[string]any)

	toggleTodo := procs["toggleTodo"].(map[string]any)
	invalidates, ok := toggleTodo["invalidates"].([]any)
	if !ok {
		t.Fatal("toggleTodo.invalidates not an array")
	}

	found := false
	for _, inv := range invalidates {
		obj, ok := inv.(map[string]any)
		if !ok {
			continue
		}
		if obj["query"] == "getTodo" {
			mapping, ok := obj["mapping"].(map[string]any)
			if !ok {
				t.Fatal("getTodo invalidation missing mapping")
			}
			idMapping, ok := mapping["id"].(map[string]any)
			if !ok {
				t.Fatal("mapping.id not an object")
			}
			if idMapping["from"] != "id" {
				t.Errorf("mapping.id.from = %v, want id", idMapping["from"])
			}
			found = true
			break
		}
	}
	if !found {
		t.Error("toggleTodo.invalidates missing {query: getTodo, mapping: ...}")
	}
}

func TestManifestCache(t *testing.T) {
	body := loadManifest(t)
	procs := body["procedures"].(map[string]any)

	for _, name := range []string{"listTodos", "getTodo"} {
		proc := procs[name].(map[string]any)
		cache, ok := proc["cache"].(map[string]any)
		if !ok {
			t.Fatalf("%s.cache not an object", name)
		}
		ttl, ok := cache["ttl"].(float64)
		if !ok || ttl != 30 {
			t.Errorf("%s.cache.ttl = %v, want 30", name, cache["ttl"])
		}
	}
}

// -- Query/Mutation tests --

func TestListTodos(t *testing.T) {
	status, body := postJSON(t, rpcEndpoint("listTodos"), map[string]any{})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	todos, ok := data["todos"].([]any)
	if !ok {
		t.Fatal("todos not an array")
	}
	if len(todos) != 2 {
		t.Errorf("len(todos) = %d, want 2", len(todos))
	}
}

func TestGetTodo(t *testing.T) {
	status, body := postJSON(t, rpcEndpoint("getTodo"), map[string]any{"id": "1"})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	if data["id"] != "1" {
		t.Errorf("id = %v, want 1", data["id"])
	}
	if data["title"] == nil {
		t.Error("missing title")
	}
	if data["done"] == nil {
		t.Error("missing done field")
	}
}

func TestCRUD(t *testing.T) {
	// Ordered subtests to verify stateful CRUD operations
	var newID string

	t.Run("addTodo", func(t *testing.T) {
		status, body := postJSON(t, rpcEndpoint("addTodo"), map[string]any{"title": "Test todo"})
		if status != 200 {
			t.Fatalf("status = %d, want 200", status)
		}
		data := extractData(t, body)
		id, ok := data["id"].(string)
		if !ok || id == "" {
			t.Fatal("missing id in addTodo response")
		}
		newID = id
		if data["title"] != "Test todo" {
			t.Errorf("title = %v, want 'Test todo'", data["title"])
		}
		if done, ok := data["done"].(bool); !ok || done {
			t.Errorf("done = %v, want false", data["done"])
		}
	})

	t.Run("listAfterAdd", func(t *testing.T) {
		status, body := postJSON(t, rpcEndpoint("listTodos"), map[string]any{})
		if status != 200 {
			t.Fatalf("status = %d, want 200", status)
		}
		data := extractData(t, body)
		todos := data["todos"].([]any)
		if len(todos) < 3 {
			t.Errorf("len(todos) = %d, want >= 3 after add", len(todos))
		}
	})

	t.Run("toggleTodo", func(t *testing.T) {
		if newID == "" {
			t.Skip("addTodo failed, skipping toggle")
		}
		status, body := postJSON(t, rpcEndpoint("toggleTodo"), map[string]any{"id": newID})
		if status != 200 {
			t.Fatalf("status = %d, want 200", status)
		}
		data := extractData(t, body)
		if done, ok := data["done"].(bool); !ok || !done {
			t.Errorf("done = %v, want true after toggle", data["done"])
		}
	})

	t.Run("getAfterToggle", func(t *testing.T) {
		if newID == "" {
			t.Skip("addTodo failed, skipping get")
		}
		status, body := postJSON(t, rpcEndpoint("getTodo"), map[string]any{"id": newID})
		if status != 200 {
			t.Fatalf("status = %d, want 200", status)
		}
		data := extractData(t, body)
		if done, ok := data["done"].(bool); !ok || !done {
			t.Errorf("done = %v, want true (state should be flipped)", data["done"])
		}
	})
}

// -- Page test --

func TestPageRender(t *testing.T) {
	status, html := getHTML(t, baseURL+"/_seam/page/")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	if !strings.Contains(html, "__seam") {
		t.Error("HTML missing __seam")
	}
}
