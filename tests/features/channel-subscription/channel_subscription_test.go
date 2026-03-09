/* tests/features/channel-subscription/channel_subscription_test.go */

package channel_subscription

import (
	"bufio"
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
	exampleDir := filepath.Join(root, "examples", "features", "channel-subscription")
	buildDir := filepath.Join(exampleDir, ".seam", "output")

	if _, err := os.Stat(filepath.Join(buildDir, "route-manifest.json")); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "build output not found: run 'seam build' in examples/features/channel-subscription first")
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

// -- SSE helpers --

type sseEvent struct {
	Event string
	ID    string
	Data  string
}

// getSSE sends a GET with ?input= query param and parses the SSE response.
// Subscriptions use GET (not POST); input is URL-encoded JSON in query string.
func getSSE(t *testing.T, endpoint string, input any) (*http.Response, []sseEvent) {
	t.Helper()
	b, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	url := endpoint + "?input=" + string(b)
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
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

// -- Manifest helpers --

func loadBuildManifest(t *testing.T) map[string]any {
	t.Helper()
	root := projectRoot()
	path := filepath.Join(root, "examples", "features", "channel-subscription", ".seam", "output", "seam-manifest.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read seam-manifest.json: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("parse seam-manifest.json: %v", err)
	}
	return m
}

// -- Page test --

func TestPageRender(t *testing.T) {
	status, html := getHTML(t, baseURL+"/")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	if !strings.Contains(html, "__seam") {
		t.Error("HTML missing __seam")
	}
}

// -- Query test --

func TestGetInfo(t *testing.T) {
	status, body := postJSON(t, rpcEndpoint("getInfo"), map[string]any{})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	if data["title"] != "Channel & Subscription Demo" {
		t.Errorf("title = %v, want 'Channel & Subscription Demo'", data["title"])
	}
}

// -- Subscription test --

func TestOnTickSSE(t *testing.T) {
	resp, events := getSSE(t, rpcEndpoint("onTick"), map[string]any{"interval": 50})
	_ = resp

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
	if dataEvents != 5 {
		t.Errorf("data events = %d, want 5", dataEvents)
	}
	if !hasComplete {
		t.Error("missing complete event")
	}

	// Verify incrementing tick values: 1, 2, 3, 4, 5
	idx := 0
	for _, e := range events {
		if e.Event != "data" {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(e.Data), &payload); err != nil {
			t.Fatalf("event[%d] data parse error: %v", idx, err)
		}
		tick, ok := payload["tick"].(float64)
		if !ok {
			t.Fatalf("event[%d] missing tick field", idx)
		}
		if int(tick) != idx+1 {
			t.Errorf("event[%d].tick = %v, want %d", idx, tick, idx+1)
		}
		idx++
	}
}

// -- Channel tests --

func TestEchoSend(t *testing.T) {
	status, body := postJSON(t, rpcEndpoint("echo.send"), map[string]any{
		"roomId": "test-send",
		"text":   "hello",
	})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}
	data := extractData(t, body)
	id, ok := data["id"].(string)
	if !ok || id == "" {
		t.Errorf("echo.send id = %v, want non-empty string", data["id"])
	}
}

func TestEchoChannel(t *testing.T) {
	roomID := fmt.Sprintf("test-channel-%d", time.Now().UnixNano())

	// Bun doesn't flush SSE headers until first data chunk, so http.Get blocks
	// until an event arrives. Run the SSE reader in a goroutine and trigger
	// data flow by sending a message concurrently.
	eventCh := make(chan sseEvent, 16)
	errCh := make(chan error, 1)
	go func() {
		b, _ := json.Marshal(map[string]any{"roomId": roomID})
		url := rpcEndpoint("echo.events") + "?input=" + string(b)
		resp, err := http.Get(url)
		if err != nil {
			errCh <- err
			return
		}
		defer func() { _ = resp.Body.Close() }()
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
					eventCh <- cur
					cur = sseEvent{}
				}
			}
		}
	}()

	// Allow SSE GET to reach server and set up subscription handler
	time.Sleep(300 * time.Millisecond)

	// Send a message — triggers the first event, which flushes SSE headers
	_, sendBody := postJSON(t, rpcEndpoint("echo.send"), map[string]any{
		"roomId": roomID,
		"text":   "hello from test",
	})
	sendData := extractData(t, sendBody)
	sentID := sendData["id"].(string)

	// Read event from SSE stream
	select {
	case event := <-eventCh:
		if event.Event != "data" {
			t.Errorf("event.Event = %q, want data", event.Event)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(event.Data), &payload); err != nil {
			t.Fatalf("parse event data: %v\nraw: %s", err, event.Data)
		}
		if payload["type"] != "message" {
			t.Errorf("event type = %v, want message", payload["type"])
		}
		inner, ok := payload["payload"].(map[string]any)
		if !ok {
			t.Fatalf("event payload not an object: %v", payload["payload"])
		}
		if inner["id"] != sentID {
			t.Errorf("event payload.id = %v, want %s", inner["id"], sentID)
		}
		if inner["text"] != "hello from test" {
			t.Errorf("event payload.text = %v, want 'hello from test'", inner["text"])
		}
	case err := <-errCh:
		t.Fatalf("SSE connection error: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for echo channel event")
	}
}

// -- Manifest tests --

func TestManifest(t *testing.T) {
	manifest := loadBuildManifest(t)
	procs, ok := manifest["procedures"].(map[string]any)
	if !ok {
		t.Fatal("procedures not an object")
	}

	t.Run("getInfo_query", func(t *testing.T) {
		gi, ok := procs["getInfo"].(map[string]any)
		if !ok {
			t.Fatal("getInfo not found")
		}
		if gi["kind"] != "query" {
			t.Errorf("getInfo.kind = %v, want query", gi["kind"])
		}
	})

	t.Run("onTick_subscription", func(t *testing.T) {
		ot, ok := procs["onTick"].(map[string]any)
		if !ok {
			t.Fatal("onTick not found")
		}
		if ot["kind"] != "subscription" {
			t.Errorf("onTick.kind = %v, want subscription", ot["kind"])
		}
	})

	t.Run("echo_events_subscription", func(t *testing.T) {
		ee, ok := procs["echo.events"].(map[string]any)
		if !ok {
			t.Fatal("echo.events not found")
		}
		if ee["kind"] != "subscription" {
			t.Errorf("echo.events.kind = %v, want subscription", ee["kind"])
		}
	})

	t.Run("echo_send_command", func(t *testing.T) {
		es, ok := procs["echo.send"].(map[string]any)
		if !ok {
			t.Fatal("echo.send not found")
		}
		if es["kind"] != "command" {
			t.Errorf("echo.send.kind = %v, want command", es["kind"])
		}
	})

	t.Run("channels_section", func(t *testing.T) {
		channels, ok := manifest["channels"].(map[string]any)
		if !ok {
			t.Fatal("channels not an object")
		}
		if _, ok := channels["echo"].(map[string]any); !ok {
			t.Fatal("echo channel not found in channels section")
		}
	})
}
