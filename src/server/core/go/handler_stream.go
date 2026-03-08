/* src/server/core/go/handler_stream.go */

package seam

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

func (s *appState) handleStream(w http.ResponseWriter, r *http.Request, name string) {
	stream, ok := s.streams[name]
	if !ok {
		writeError(w, http.StatusNotFound, NotFoundError(fmt.Sprintf("Stream '%s' not found", name)))
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeSSEError(w, ValidationError("Failed to read request body"))
		return
	}

	if !json.Valid(body) {
		writeSSEError(w, ValidationError("Invalid JSON"))
		return
	}

	if s.shouldValidate {
		if cs, ok := s.compiledStreamSchemas[name]; ok {
			var parsed any
			_ = json.Unmarshal(body, &parsed)
			if msg, details := validateCompiled(cs, parsed); msg != "" {
				writeSSEError(w, ValidationErrorDetailed(
					fmt.Sprintf("Input validation failed for stream '%s': %s", name, msg), toAnySlice(details)))
				return
			}
		}
	}

	ctx := r.Context()
	if len(s.contextConfigs) > 0 && len(stream.ContextKeys) > 0 {
		rawCtx := extractRawContext(r, s.contextConfigs)
		filtered := resolveContextForProc(rawCtx, stream.ContextKeys)
		ctx = injectContext(ctx, filtered)
	}

	ch, err := stream.Handler(ctx, body)
	if err != nil {
		if seamErr, ok := err.(*Error); ok {
			writeSSEError(w, seamErr)
		} else {
			writeSSEError(w, InternalError(err.Error()))
		}
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, canFlush := w.(http.Flusher)
	idle := s.opts.SSEIdleTimeout
	seq := 0
	heartbeatTicker := time.NewTicker(s.opts.HeartbeatInterval)
	defer heartbeatTicker.Stop()

	var idleTimer *time.Timer
	if idle > 0 {
		idleTimer = time.NewTimer(idle)
		defer idleTimer.Stop()
	}

	for {
		if idle > 0 {
			select {
			case ev, ok := <-ch:
				if !ok {
					goto complete
				}
				writeStreamEvent(w, ev, seq)
				seq++
				if canFlush {
					flusher.Flush()
				}
				if !idleTimer.Stop() {
					select {
					case <-idleTimer.C:
					default:
					}
				}
				idleTimer.Reset(idle)
			case <-heartbeatTicker.C:
				_, _ = fmt.Fprintf(w, ": heartbeat\n\n")
				if canFlush {
					flusher.Flush()
				}
			case <-idleTimer.C:
				goto complete
			case <-r.Context().Done():
				return
			}
		} else {
			select {
			case ev, ok := <-ch:
				if !ok {
					goto complete
				}
				writeStreamEvent(w, ev, seq)
				seq++
				if canFlush {
					flusher.Flush()
				}
			case <-heartbeatTicker.C:
				_, _ = fmt.Fprintf(w, ": heartbeat\n\n")
				if canFlush {
					flusher.Flush()
				}
			case <-r.Context().Done():
				return
			}
		}
	}

complete:
	_, _ = fmt.Fprintf(w, "event: complete\ndata: {}\n\n")
	if canFlush {
		flusher.Flush()
	}
}

func writeStreamEvent(w http.ResponseWriter, ev StreamEvent, seq int) {
	if ev.Err != nil {
		_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", mustJSON(map[string]any{
			"code": ev.Err.Code, "message": ev.Err.Message, "transient": false,
		}))
	} else {
		_, _ = fmt.Fprintf(w, "event: data\nid: %d\ndata: %s\n\n", seq, mustJSON(ev.Value))
	}
}
