/* tests/integration/subscribe_test.go */

package integration

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// sseEvent represents a parsed SSE event
type sseEvent struct {
	Event string
	Data  string
}

// readSSEResp returns the raw http.Response alongside parsed events for header inspection.
func readSSEResp(t *testing.T, url string) (*http.Response, []sseEvent) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}

	if resp.StatusCode != 200 {
		resp.Body.Close()
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
	return resp, events
}

func TestSubscribeEndpoint(t *testing.T) {
	validEventTypes := map[string]bool{"data": true, "error": true, "complete": true}

	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			t.Run("onCount streams data events", func(t *testing.T) {
				sseURL := fmt.Sprintf("%s/_seam/procedure/onCount?input=%s",
					b.BaseURL, url.QueryEscape(`{"max":3}`))
				resp, events := readSSEResp(t, sseURL)
				defer resp.Body.Close()

				assertContentType(t, resp, "text/event-stream")

				// Every event must be a known type
				for i, ev := range events {
					if !validEventTypes[ev.Event] {
						t.Errorf("events[%d].event = %q, want one of data/error/complete", i, ev.Event)
					}
				}

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

				// SSE id field: not asserted — no runtime implements it yet
			})

			t.Run("unknown subscription returns error event", func(t *testing.T) {
				sseURL := b.BaseURL + "/_seam/procedure/nonexistent?input=%7B%7D"
				resp, events := readSSEResp(t, sseURL)
				defer resp.Body.Close()

				if len(events) == 0 {
					t.Fatal("expected at least one SSE event")
				}

				// First event should be an error
				first := events[0]
				if first.Event != "error" {
					t.Fatalf("first event = %q, want 'error'", first.Event)
				}

				var errPayload map[string]any
				if err := json.Unmarshal([]byte(first.Data), &errPayload); err != nil {
					t.Fatalf("failed to parse error event data: %v", err)
				}
				if _, ok := errPayload["code"].(string); !ok {
					t.Error("error event missing 'code' string")
				}
				if _, ok := errPayload["message"].(string); !ok {
					t.Error("error event missing 'message' string")
				}
				if _, ok := errPayload["transient"].(bool); !ok {
					t.Error("error event missing 'transient' bool")
				}
			})
		})
	}
}
