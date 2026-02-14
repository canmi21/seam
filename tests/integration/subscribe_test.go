/* tests/integration/subscribe_test.go */

package integration

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// sseEvent represents a parsed SSE event
type sseEvent struct {
	Event string
	Data  string
}

func readSSE(t *testing.T, url string) []sseEvent {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var events []sseEvent
	scanner := bufio.NewScanner(resp.Body)
	var current sseEvent
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event: ") {
			current.Event = strings.TrimPrefix(line, "event: ")
		} else if strings.HasPrefix(line, "data: ") {
			current.Data = strings.TrimPrefix(line, "data: ")
		} else if line == "" && current.Event != "" {
			events = append(events, current)
			current = sseEvent{}
		}
	}
	if current.Event != "" {
		events = append(events, current)
	}
	return events
}

func TestSubscribeEndpoint(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			t.Run("onCount streams data events", func(t *testing.T) {
				url := fmt.Sprintf("%s/_seam/subscribe/onCount?input=%s",
					b.BaseURL, `{"max":3}`)
				events := readSSE(t, url)

				// Should have 3 data events + 1 complete event
				dataEvents := 0
				hasComplete := false
				for _, ev := range events {
					if ev.Event == "data" {
						dataEvents++
						var payload map[string]any
						if err := json.Unmarshal([]byte(ev.Data), &payload); err != nil {
							t.Errorf("failed to parse data event: %v", err)
						}
						if _, ok := payload["n"]; !ok {
							t.Error("data event missing 'n' field")
						}
					}
					if ev.Event == "complete" {
						hasComplete = true
					}
				}
				if dataEvents != 3 {
					t.Errorf("data event count = %d, want 3", dataEvents)
				}
				if !hasComplete {
					t.Error("missing complete event")
				}
			})

			t.Run("unknown subscription returns error", func(t *testing.T) {
				resp, err := http.Get(b.BaseURL + "/_seam/subscribe/nonexistent")
				if err != nil {
					t.Fatalf("GET: %v", err)
				}
				resp.Body.Close()
				// TS returns SSE stream with error event, Rust returns 404
				if resp.StatusCode != 200 && resp.StatusCode != 404 {
					t.Errorf("status = %d, want 200 or 404", resp.StatusCode)
				}
			})
		})
	}
}

func TestSubscribeManifestType(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			url := b.BaseURL + "/_seam/manifest.json"
			_, body := getJSON(t, url)
			procs, ok := body["procedures"].(map[string]any)
			if !ok {
				t.Fatalf("procedures not an object")
			}

			// Check that onCount has type: subscription
			onCount, ok := procs["onCount"].(map[string]any)
			if !ok {
				t.Fatal("onCount not found in manifest")
			}
			procType, _ := onCount["type"].(string)
			if procType != "subscription" {
				t.Errorf("onCount.type = %q, want 'subscription'", procType)
			}

			// Check that greet has type: query
			greetProc, ok := procs["greet"].(map[string]any)
			if !ok {
				t.Fatal("greet not found in manifest")
			}
			greetType, _ := greetProc["type"].(string)
			if greetType != "query" {
				t.Errorf("greet.type = %q, want 'query'", greetType)
			}
		})
	}
}
