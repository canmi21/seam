/* tests/features/stream-upload/stream_upload_test.go */

package stream_upload

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
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
	exampleDir := filepath.Join(root, "examples", "features", "stream-upload")
	buildDir := filepath.Join(exampleDir, ".seam", "output")

	if _, err := os.Stat(filepath.Join(buildDir, "route-manifest.json")); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "build output not found: run 'seam build' in examples/features/stream-upload first")
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

// -- SSE helpers --

type sseEvent struct {
	Event string
	ID    string
	Data  string
}

// postSSE sends a POST with JSON body and parses the SSE response.
func postSSE(t *testing.T, url string, payload any) (*http.Response, []sseEvent) {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}

	var events []sseEvent
	scanner := bufio.NewScanner(resp.Body)
	var cur sseEvent
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			cur.Event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "id: "):
			cur.ID = strings.TrimPrefix(line, "id: ")
		case strings.HasPrefix(line, "data: "):
			cur.Data = strings.TrimPrefix(line, "data: ")
		case line == "":
			if cur.Event != "" || cur.Data != "" {
				events = append(events, cur)
				cur = sseEvent{}
			}
		}
	}
	_ = resp.Body.Close()
	return resp, events
}

// buildMultipart creates a multipart form with a metadata JSON field and a file field.
func buildMultipart(metadata any, fileName string, content []byte) (body *bytes.Buffer, contentType string) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	metaJSON, _ := json.Marshal(metadata)
	_ = w.WriteField("metadata", string(metaJSON))

	fw, _ := w.CreateFormFile("file", fileName)
	_, _ = fw.Write(content)
	_ = w.Close()
	return &buf, w.FormDataContentType()
}

// -- Manifest tests --

func TestManifestStreamKind(t *testing.T) {
	status, body := getJSON(t, baseURL+"/_seam/manifest.json")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	procs, ok := body["procedures"].(map[string]any)
	if !ok {
		t.Fatal("procedures not an object")
	}
	cs, ok := procs["countStream"].(map[string]any)
	if !ok {
		t.Fatal("countStream not found in manifest")
	}
	if cs["kind"] != "stream" {
		t.Errorf("countStream.kind = %v, want stream", cs["kind"])
	}
	if cs["chunkOutput"] == nil {
		t.Error("countStream missing chunkOutput")
	}
	if cs["output"] != nil {
		t.Error("countStream should not have output (uses chunkOutput)")
	}
}

func TestManifestUploadKind(t *testing.T) {
	status, body := getJSON(t, baseURL+"/_seam/manifest.json")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	procs := body["procedures"].(map[string]any)
	eu, ok := procs["echoUpload"].(map[string]any)
	if !ok {
		t.Fatal("echoUpload not found in manifest")
	}
	if eu["kind"] != "upload" {
		t.Errorf("echoUpload.kind = %v, want upload", eu["kind"])
	}
}

func TestManifestQueryKind(t *testing.T) {
	status, body := getJSON(t, baseURL+"/_seam/manifest.json")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	procs := body["procedures"].(map[string]any)
	gi, ok := procs["getInfo"].(map[string]any)
	if !ok {
		t.Fatal("getInfo not found in manifest")
	}
	if gi["kind"] != "query" {
		t.Errorf("getInfo.kind = %v, want query", gi["kind"])
	}
}

// -- Stream tests --

func TestStreamSSE(t *testing.T) {
	resp, events := postSSE(t, rpcEndpoint("countStream"), map[string]any{"max": 3})
	_ = resp

	// Expect 3 data events + 1 complete event
	dataEvents := 0
	hasComplete := false
	for _, e := range events {
		switch e.Event {
		case "data":
			dataEvents++
		case "complete":
			hasComplete = true
		}
	}
	if dataEvents != 3 {
		t.Errorf("data events = %d, want 3", dataEvents)
	}
	if !hasComplete {
		t.Error("missing complete event")
	}

	// Verify incrementing IDs: 0, 1, 2
	idx := 0
	for _, e := range events {
		if e.Event == "data" {
			expected := fmt.Sprintf("%d", idx)
			if e.ID != expected {
				t.Errorf("event[%d].id = %q, want %q", idx, e.ID, expected)
			}
			idx++
		}
	}
}

func TestStreamContentType(t *testing.T) {
	resp, _ := postSSE(t, rpcEndpoint("countStream"), map[string]any{"max": 1})
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("Content-Type = %q, want text/event-stream", ct)
	}
}

func TestStreamDataPayload(t *testing.T) {
	_, events := postSSE(t, rpcEndpoint("countStream"), map[string]any{"max": 3})

	idx := 0
	for _, e := range events {
		if e.Event != "data" {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(e.Data), &payload); err != nil {
			t.Fatalf("event[%d] data parse error: %v", idx, err)
		}
		n, ok := payload["n"].(float64)
		if !ok {
			t.Fatalf("event[%d] missing n field", idx)
		}
		if int(n) != idx {
			t.Errorf("event[%d].n = %v, want %d", idx, n, idx)
		}
		idx++
	}
}

// -- Upload test --

func TestUploadEcho(t *testing.T) {
	content := []byte("hello world from test")
	body, contentType := buildMultipart(
		map[string]any{"filename": "test.txt"},
		"test.txt",
		content,
	)

	resp, err := http.Post(rpcEndpoint("echoUpload"), contentType, body)
	if err != nil {
		t.Fatalf("POST upload: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	raw, _ := io.ReadAll(resp.Body)
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("unmarshal: %v\nbody: %s", err, raw)
	}

	data := extractData(t, result)
	if data["fileId"] == nil || data["fileId"] == "" {
		t.Error("missing fileId")
	}
	if data["filename"] != "test.txt" {
		t.Errorf("filename = %v, want test.txt", data["filename"])
	}
	size, ok := data["size"].(float64)
	if !ok || size <= 0 {
		t.Errorf("size = %v, want > 0", data["size"])
	}
}

// -- Query test --

func TestQueryGetInfo(t *testing.T) {
	status, body := postJSON(t, rpcEndpoint("getInfo"), map[string]any{})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	if data["title"] != "Stream & Upload Demo" {
		t.Errorf("title = %v, want 'Stream & Upload Demo'", data["title"])
	}
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
