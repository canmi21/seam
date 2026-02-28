/* tests/integration/channel_test.go */

package integration

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// backendHasChannels checks the manifest for a channels field.
func backendHasChannels(t *testing.T, baseURL string) bool {
	t.Helper()
	_, body := getJSON(t, baseURL+"/_seam/manifest.json")
	_, ok := body["channels"].(map[string]any)
	return ok
}

func TestChannelCommand(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			// Only Bun example declares channels; other backends skip.
			if !backendHasChannels(t, b.BaseURL) {
				t.Skip("backend does not declare channels")
			}
			procURL := b.BaseURL + "/_seam/procedure/"

			t.Run("sendMessage returns ok with data", func(t *testing.T) {
				status, body := postJSON(t, procURL+"chat.sendMessage", map[string]any{
					"roomId": "room1",
					"text":   "hello",
				})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				data := assertOK(t, body)
				dataMap := data.(map[string]any)
				if _, ok := dataMap["id"].(string); !ok {
					t.Errorf("data.id not a string: %v", dataMap["id"])
				}
				if _, ok := dataMap["timestamp"].(float64); !ok {
					t.Errorf("data.timestamp not a number: %v", dataMap["timestamp"])
				}
			})

			t.Run("sendTyping returns ok", func(t *testing.T) {
				status, body := postJSON(t, procURL+"chat.sendTyping", map[string]any{
					"roomId": "room1",
				})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				assertOK(t, body)
			})
		})
	}
}

func TestChannelSubscription(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			if !backendHasChannels(t, b.BaseURL) {
				t.Skip("backend does not declare channels")
			}

			t.Run("receives tagged union events", func(t *testing.T) {
				// Unique room to avoid cross-test interference
				roomID := fmt.Sprintf("sse-test-%d", time.Now().UnixNano())
				sseURL := fmt.Sprintf("%s/_seam/procedure/chat.events?input=%s",
					b.BaseURL, url.QueryEscape(fmt.Sprintf(`{"roomId":"%s"}`, roomID)))

				// chat.events is an infinite stream. Bun won't flush SSE headers
				// until the first data chunk, so http.Get blocks until an event
				// arrives. We must connect in a goroutine and trigger events from
				// the main goroutine to unblock the header flush.
				eventCh := make(chan sseEvent, 10)
				connErrCh := make(chan error, 1)
				connOkCh := make(chan *http.Response, 1)

				go func() {
					resp, err := http.Get(sseURL)
					if err != nil {
						connErrCh <- err
						return
					}
					connOkCh <- resp
					scanner := bufio.NewScanner(resp.Body)
					var current sseEvent
					for scanner.Scan() {
						line := scanner.Text()
						if strings.HasPrefix(line, "event: ") {
							current.Event = strings.TrimPrefix(line, "event: ")
						} else if strings.HasPrefix(line, "data: ") {
							current.Data = strings.TrimPrefix(line, "data: ")
						} else if line == "" && current.Event != "" {
							eventCh <- current
							current = sseEvent{}
						}
					}
					close(eventCh)
				}()

				// Brief pause for the server to register the subscription,
				// then trigger events to flush Bun's SSE headers.
				time.Sleep(200 * time.Millisecond)

				procURL := b.BaseURL + "/_seam/procedure/"
				postJSON(t, procURL+"chat.sendMessage", map[string]any{
					"roomId": roomID,
					"text":   "hello",
				})
				postJSON(t, procURL+"chat.sendTyping", map[string]any{
					"roomId": roomID,
				})

				// Wait for connection or error
				var resp *http.Response
				select {
				case resp = <-connOkCh:
					defer resp.Body.Close()
				case err := <-connErrCh:
					t.Fatalf("SSE connection error: %v", err)
				case <-time.After(5 * time.Second):
					t.Fatal("timeout waiting for SSE connection")
				}

				assertContentType(t, resp, "text/event-stream")

				// Collect 2 events
				var events []sseEvent
				timeout := time.After(5 * time.Second)
				for len(events) < 2 {
					select {
					case ev, ok := <-eventCh:
						if !ok {
							t.Fatal("SSE stream closed unexpectedly")
						}
						events = append(events, ev)
					case <-timeout:
						t.Fatalf("timeout: received %d events, want 2", len(events))
					}
				}

				// Both must be SSE "data" event type
				for i, ev := range events {
					if ev.Event != "data" {
						t.Errorf("events[%d].event = %q, want 'data'", i, ev.Event)
					}
				}

				// First: newMessage with tagged union format
				var msg1 map[string]any
				if err := json.Unmarshal([]byte(events[0].Data), &msg1); err != nil {
					t.Fatalf("parse event[0]: %v", err)
				}
				if msg1["type"] != "newMessage" {
					t.Errorf("event[0].type = %v, want 'newMessage'", msg1["type"])
				}
				payload1, ok := msg1["payload"].(map[string]any)
				if !ok {
					t.Fatal("event[0].payload not an object")
				}
				if payload1["text"] != "hello" {
					t.Errorf("payload.text = %v, want 'hello'", payload1["text"])
				}

				// Second: typing
				var msg2 map[string]any
				if err := json.Unmarshal([]byte(events[1].Data), &msg2); err != nil {
					t.Fatalf("parse event[1]: %v", err)
				}
				if msg2["type"] != "typing" {
					t.Errorf("event[1].type = %v, want 'typing'", msg2["type"])
				}
				payload2, ok := msg2["payload"].(map[string]any)
				if !ok {
					t.Fatal("event[1].payload not an object")
				}
				if _, ok := payload2["user"].(string); !ok {
					t.Error("typing payload missing 'user' string field")
				}
			})
		})
	}
}

func TestChannelManifest(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			_, body := getJSON(t, b.BaseURL+"/_seam/manifest.json")
			channels, ok := body["channels"].(map[string]any)
			if !ok {
				t.Skip("backend manifest does not include channels")
			}
			procs := body["procedures"].(map[string]any)

			t.Run("expanded procedures exist", func(t *testing.T) {
				required := []string{"chat.sendMessage", "chat.sendTyping", "chat.events"}
				for _, name := range required {
					if _, exists := procs[name]; !exists {
						t.Errorf("missing expanded procedure %q", name)
					}
				}
			})

			t.Run("expanded procedure types", func(t *testing.T) {
				assertType := func(name, expected string) {
					proc, ok := procs[name].(map[string]any)
					if !ok {
						t.Errorf("procedure %q not found", name)
						return
					}
					got, _ := proc["type"].(string)
					if got != expected {
						t.Errorf("%s.type = %q, want %q", name, got, expected)
					}
				}
				assertType("chat.sendMessage", "command")
				assertType("chat.sendTyping", "command")
				assertType("chat.events", "subscription")
			})

			t.Run("channel IR hint structure", func(t *testing.T) {
				chat, ok := channels["chat"].(map[string]any)
				if !ok {
					t.Fatal("channels.chat not an object")
				}

				// Channel input schema
				input, ok := chat["input"].(map[string]any)
				if !ok {
					t.Fatal("chat.input not an object")
				}
				props, _ := input["properties"].(map[string]any)
				if _, ok := props["roomId"]; !ok {
					t.Error("chat.input missing roomId property")
				}

				// Incoming messages
				incoming, ok := chat["incoming"].(map[string]any)
				if !ok {
					t.Fatal("chat.incoming not an object")
				}
				for _, name := range []string{"sendMessage", "sendTyping"} {
					msg, ok := incoming[name].(map[string]any)
					if !ok {
						t.Errorf("chat.incoming.%s not an object", name)
						continue
					}
					if _, ok := msg["input"].(map[string]any); !ok {
						t.Errorf("chat.incoming.%s.input not an object", name)
					}
					if _, ok := msg["output"].(map[string]any); !ok {
						t.Errorf("chat.incoming.%s.output not an object", name)
					}
				}

				// Outgoing events
				outgoing, ok := chat["outgoing"].(map[string]any)
				if !ok {
					t.Fatal("chat.outgoing not an object")
				}
				for _, name := range []string{"newMessage", "typing"} {
					if _, ok := outgoing[name].(map[string]any); !ok {
						t.Errorf("chat.outgoing.%s not an object", name)
					}
				}
			})
		})
	}
}

func TestChannelCoexistence(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			if !backendHasChannels(t, b.BaseURL) {
				t.Skip("backend does not declare channels")
			}
			procURL := b.BaseURL + "/_seam/procedure/"

			t.Run("query still works alongside channels", func(t *testing.T) {
				status, body := postJSON(t, procURL+"greet", map[string]any{"name": "Channel"})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				data := assertOK(t, body)
				msg, _ := data.(map[string]any)["message"].(string)
				if msg != "Hello, Channel!" {
					t.Errorf("message = %q, want %q", msg, "Hello, Channel!")
				}
			})

			t.Run("subscription still works alongside channels", func(t *testing.T) {
				sseURL := fmt.Sprintf("%s/_seam/procedure/onCount?input=%s",
					b.BaseURL, url.QueryEscape(`{"max":2}`))
				resp, events := readSSEResp(t, sseURL)
				defer resp.Body.Close()
				dataCount := 0
				for _, ev := range events {
					if ev.Event == "data" {
						dataCount++
					}
				}
				if dataCount != 2 {
					t.Errorf("data event count = %d, want 2", dataCount)
				}
			})
		})
	}
}
