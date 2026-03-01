/* src/server/core/go/handler_ws.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// isWebSocketUpgrade checks if the request is a WebSocket upgrade.
func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

var wsUpgrader = websocket.Upgrader{
	// Permissive origin check; production deployments should override.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// --- wire types ---

type wsUplink struct {
	ID        string          `json:"id"`
	Procedure string          `json:"procedure"`
	Input     json.RawMessage `json:"input"`
}

type wsResponse struct {
	ID    string      `json:"id"`
	Ok    bool        `json:"ok"`
	Data  interface{} `json:"data,omitempty"`
	Error *wsError    `json:"error,omitempty"`
}

type wsError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Transient bool   `json:"transient"`
}

type wsPush struct {
	Event   string      `json:"event"`
	Payload interface{} `json:"payload"`
}

type wsHeartbeat struct {
	Heartbeat bool `json:"heartbeat"`
}

// handleChannelWs upgrades an SSE subscribe request to a WebSocket when
// the client sends an Upgrade header. All channel communication (commands
// + subscription events) flows over the single persistent connection.
func (s *appState) handleChannelWs(w http.ResponseWriter, r *http.Request) {
	// Parse channel name: strip "/_seam/procedure/" prefix and ".events" suffix
	rawName := r.PathValue("name")
	channelName := strings.TrimSuffix(rawName, ".events")

	// Validate subscription exists (channel expands to "<channel>.events")
	subName := channelName + ".events"
	sub, ok := s.subs[subName]
	if !ok {
		http.Error(w, fmt.Sprintf("Channel subscription '%s' not found", subName), http.StatusNotFound)
		return
	}

	// Parse channel input from query parameter
	inputStr := r.URL.Query().Get("input")
	var channelInput json.RawMessage
	if inputStr != "" {
		channelInput = json.RawMessage(inputStr)
	} else {
		channelInput = json.RawMessage("{}")
	}

	// Start subscription with a cancellable context
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	eventCh, err := sub.Handler(ctx, channelInput)
	if err != nil {
		if seamErr, ok := err.(*Error); ok {
			http.Error(w, seamErr.Message, errorHTTPStatus(seamErr))
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	// Upgrade to WebSocket
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade writes its own error response
		return
	}

	// Mutex protects concurrent writes (heartbeat + push + response)
	var writeMu sync.Mutex
	writeJSON := func(v interface{}) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(v)
	}

	var wg sync.WaitGroup

	// --- write loop: forward subscription events + heartbeat ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case ev, ok := <-eventCh:
				if !ok {
					// Subscription closed; close the WebSocket
					writeMu.Lock()
					conn.WriteMessage(websocket.CloseMessage,
						websocket.FormatCloseMessage(websocket.CloseNormalClosure, "subscription ended"))
					writeMu.Unlock()
					cancel()
					return
				}
				if ev.Err != nil {
					writeJSON(wsResponse{
						Ok: false,
						Error: &wsError{
							Code:    ev.Err.Code,
							Message: ev.Err.Message,
						},
					})
					continue
				}
				// Channel subscription events are maps with "type" and "payload"
				if m, ok := ev.Value.(map[string]interface{}); ok {
					eventType, _ := m["type"].(string)
					payload := m["payload"]
					writeJSON(wsPush{Event: eventType, Payload: payload})
				} else {
					// Fallback: send raw value as a "data" event
					writeJSON(wsPush{Event: "data", Payload: ev.Value})
				}

			case <-ticker.C:
				writeJSON(wsHeartbeat{Heartbeat: true})

			case <-ctx.Done():
				return
			}
		}
	}()

	// --- read loop: receive uplink commands ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cancel()

		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				// Client disconnected or read error
				return
			}

			var uplink wsUplink
			if err := json.Unmarshal(message, &uplink); err != nil {
				writeJSON(wsResponse{
					ID: "",
					Ok: false,
					Error: &wsError{
						Code:    "VALIDATION_ERROR",
						Message: "Invalid uplink JSON",
					},
				})
				continue
			}

			// Validate procedure belongs to this channel (and is not .events)
			prefix := channelName + "."
			if !strings.HasPrefix(uplink.Procedure, prefix) || uplink.Procedure == channelName+".events" {
				writeJSON(wsResponse{
					ID: uplink.ID,
					Ok: false,
					Error: &wsError{
						Code:    "VALIDATION_ERROR",
						Message: fmt.Sprintf("Procedure '%s' is not a command of channel '%s'", uplink.Procedure, channelName),
					},
				})
				continue
			}

			// Resolve hash -> original name when hash map is present
			procName := uplink.Procedure
			if s.hashToName != nil {
				resolved, ok := s.hashToName[procName]
				if !ok {
					writeJSON(wsResponse{
						ID: uplink.ID,
						Ok: false,
						Error: &wsError{
							Code:    "NOT_FOUND",
							Message: fmt.Sprintf("Procedure '%s' not found", procName),
						},
					})
					continue
				}
				procName = resolved
			}

			proc, ok := s.handlers[procName]
			if !ok {
				writeJSON(wsResponse{
					ID: uplink.ID,
					Ok: false,
					Error: &wsError{
						Code:    "NOT_FOUND",
						Message: fmt.Sprintf("Procedure '%s' not found", procName),
					},
				})
				continue
			}

			// Merge channel input + uplink input
			mergedInput := mergeJSONInputs(channelInput, uplink.Input)

			// Dispatch command (explicit cancel to avoid defer leak in loop)
			rpcCtx := ctx
			var rpcCancel context.CancelFunc
			if s.opts.RPCTimeout > 0 {
				rpcCtx, rpcCancel = context.WithTimeout(ctx, s.opts.RPCTimeout)
			}

			result, err := proc.Handler(rpcCtx, mergedInput)
			if rpcCancel != nil {
				rpcCancel()
			}
			if err != nil {
				if rpcCtx.Err() == context.DeadlineExceeded {
					writeJSON(wsResponse{
						ID: uplink.ID,
						Ok: false,
						Error: &wsError{
							Code:      "INTERNAL_ERROR",
							Message:   "RPC timed out",
							Transient: true,
						},
					})
					continue
				}
				if seamErr, ok := err.(*Error); ok {
					writeJSON(wsResponse{
						ID: uplink.ID,
						Ok: false,
						Error: &wsError{
							Code:    seamErr.Code,
							Message: seamErr.Message,
						},
					})
				} else {
					writeJSON(wsResponse{
						ID: uplink.ID,
						Ok: false,
						Error: &wsError{
							Code:    "INTERNAL_ERROR",
							Message: err.Error(),
						},
					})
				}
				continue
			}

			writeJSON(wsResponse{
				ID:   uplink.ID,
				Ok:   true,
				Data: result,
			})
		}
	}()

	wg.Wait()
	conn.Close()
}

// mergeJSONInputs merges two JSON objects (channel input + uplink input).
// Uplink keys override channel keys on conflict.
func mergeJSONInputs(base, overlay json.RawMessage) json.RawMessage {
	if len(overlay) == 0 || string(overlay) == "null" {
		return base
	}
	if len(base) == 0 || string(base) == "null" {
		return overlay
	}

	var baseMap map[string]json.RawMessage
	var overlayMap map[string]json.RawMessage

	if err := json.Unmarshal(base, &baseMap); err != nil {
		return overlay
	}
	if err := json.Unmarshal(overlay, &overlayMap); err != nil {
		return base
	}

	for k, v := range overlayMap {
		baseMap[k] = v
	}

	merged, err := json.Marshal(baseMap)
	if err != nil {
		return overlay
	}
	return merged
}