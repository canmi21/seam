/* src/server/core/go/handler_batch.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// --- batch RPC handler ---

type batchRequest struct {
	Calls []batchCall `json:"calls"`
}

type batchCall struct {
	Procedure string          `json:"procedure"`
	Input     json.RawMessage `json:"input"`
}

type batchResult struct {
	Ok    bool        `json:"ok"`
	Data  any         `json:"data,omitempty"`
	Error *batchError `json:"error,omitempty"`
}

type batchError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Transient bool   `json:"transient"`
}

func (s *appState) handleBatch(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, ValidationError("Failed to read request body"))
		return
	}

	var batch batchRequest
	if err := json.Unmarshal(body, &batch); err != nil {
		writeError(w, http.StatusBadRequest, ValidationError("Invalid batch JSON"))
		return
	}

	ctx := r.Context()
	if s.opts.RPCTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.opts.RPCTimeout)
		defer cancel()
	}

	results := make([]batchResult, len(batch.Calls))
	for i, call := range batch.Calls {
		// Resolve hash -> original name
		name := call.Procedure
		if s.hashToName != nil {
			resolved, ok := s.hashToName[name]
			if !ok {
				results[i] = batchResult{Ok: false, Error: &batchError{Code: "NOT_FOUND", Message: fmt.Sprintf("Procedure '%s' not found", name)}}
				continue
			}
			name = resolved
		}

		proc, ok := s.handlers[name]
		if !ok {
			results[i] = batchResult{Ok: false, Error: &batchError{Code: "NOT_FOUND", Message: fmt.Sprintf("Procedure '%s' not found", name)}}
			continue
		}

		input := call.Input
		if len(input) == 0 {
			input = json.RawMessage("{}")
		}

		result, err := proc.Handler(ctx, input)
		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				results[i] = batchResult{Ok: false, Error: &batchError{Code: "INTERNAL_ERROR", Message: "RPC timed out"}}
				continue
			}
			if seamErr, ok := err.(*Error); ok {
				results[i] = batchResult{Ok: false, Error: &batchError{Code: seamErr.Code, Message: seamErr.Message}}
			} else {
				results[i] = batchResult{Ok: false, Error: &batchError{Code: "INTERNAL_ERROR", Message: err.Error()}}
			}
			continue
		}
		results[i] = batchResult{Ok: true, Data: result}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": map[string]any{"results": results}})
}

// --- subscribe handler ---

func (s *appState) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	if isWebSocketUpgrade(r) {
		s.handleChannelWs(w, r)
		return
	}

	name := r.PathValue("name")

	sub, ok := s.subs[name]
	if !ok {
		writeSSEError(w, NotFoundError(fmt.Sprintf("Subscription '%s' not found", name)))
		return
	}

	inputStr := r.URL.Query().Get("input")
	var rawInput json.RawMessage
	if inputStr != "" {
		rawInput = json.RawMessage(inputStr)
	} else {
		rawInput = json.RawMessage("{}")
	}

	ch, err := sub.Handler(r.Context(), rawInput)
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

	for {
		if idle > 0 {
			select {
			case ev, ok := <-ch:
				if !ok {
					goto complete
				}
				writeSSEEvent(w, ev)
				if canFlush {
					flusher.Flush()
				}
			case <-time.After(idle):
				goto complete
			case <-r.Context().Done():
				return
			}
		} else {
			ev, ok := <-ch
			if !ok {
				goto complete
			}
			writeSSEEvent(w, ev)
			if canFlush {
				flusher.Flush()
			}
		}
	}

complete:
	fmt.Fprintf(w, "event: complete\ndata: {}\n\n")
	if canFlush {
		flusher.Flush()
	}
}

func writeSSEEvent(w http.ResponseWriter, ev SubscriptionEvent) {
	if ev.Err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", mustJSON(map[string]any{
			"code": ev.Err.Code, "message": ev.Err.Message, "transient": false,
		}))
	} else {
		fmt.Fprintf(w, "event: data\ndata: %s\n\n", mustJSON(ev.Value))
	}
}

func writeSSEError(w http.ResponseWriter, e *Error) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	fmt.Fprintf(w, "event: error\ndata: %s\n\n", mustJSON(map[string]any{
		"code": e.Code, "message": e.Message, "transient": false,
	}))
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}
