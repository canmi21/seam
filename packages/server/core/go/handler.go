/* packages/server/core/go/handler.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	injector "github.com/canmi21/seam/packages/server/injector/go"
)

type appState struct {
	manifestJSON []byte
	handlers     map[string]*ProcedureDef
	subs         map[string]*SubscriptionDef
	opts         HandlerOptions
	hashToName   map[string]string // reverse lookup: hash -> original name (nil if no hash map)
	batchHash    string            // batch endpoint hash (empty if no hash map)
}

func buildHandler(procedures []ProcedureDef, subscriptions []SubscriptionDef, pages []PageDef, rpcHashMap *RpcHashMap, opts HandlerOptions) http.Handler {
	state := &appState{
		handlers: make(map[string]*ProcedureDef),
		subs:     make(map[string]*SubscriptionDef),
		opts:     opts,
	}

	if rpcHashMap != nil {
		state.hashToName = rpcHashMap.ReverseLookup()
		state.batchHash = rpcHashMap.Batch
	}

	// Build manifest
	manifest := buildManifest(procedures, subscriptions)
	state.manifestJSON, _ = json.Marshal(manifest)

	for i := range procedures {
		state.handlers[procedures[i].Name] = &procedures[i]
	}
	for i := range subscriptions {
		state.subs[subscriptions[i].Name] = &subscriptions[i]
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /_seam/manifest.json", state.handleManifest)
	mux.HandleFunc("POST /_seam/rpc/{name}", state.handleRPC)
	mux.HandleFunc("GET /_seam/subscribe/{name}", state.handleSubscribe)

	// Pages are served under /_seam/page/* prefix only.
	// Root-path serving (e.g. "/" or "/dashboard/:id") is the application's
	// responsibility — use http.Handler fallback (e.g. gin.NoRoute) to rewrite
	// paths to /_seam/page/*. See the github-dashboard go-gin example.
	for i := range pages {
		goPattern := seamRouteToGoPattern(pages[i].Route)
		page := &pages[i]
		mux.HandleFunc("GET /_seam/page"+goPattern, state.makePageHandler(page))
	}

	return mux
}

// seamRouteToGoPattern converts ":param" style to "{param}" style.
func seamRouteToGoPattern(route string) string {
	parts := strings.Split(route, "/")
	for i, p := range parts {
		if strings.HasPrefix(p, ":") {
			parts[i] = "{" + p[1:] + "}"
		}
	}
	return strings.Join(parts, "/")
}

// --- manifest ---

type manifestSchema struct {
	Version    string                    `json:"version"`
	Procedures map[string]procedureEntry `json:"procedures"`
}

type procedureEntry struct {
	Type   string `json:"type"`
	Input  any    `json:"input"`
	Output any    `json:"output"`
}

func buildManifest(procedures []ProcedureDef, subscriptions []SubscriptionDef) manifestSchema {
	procs := make(map[string]procedureEntry)
	for _, p := range procedures {
		procs[p.Name] = procedureEntry{
			Type:   "query",
			Input:  p.InputSchema,
			Output: p.OutputSchema,
		}
	}
	for _, s := range subscriptions {
		procs[s.Name] = procedureEntry{
			Type:   "subscription",
			Input:  s.InputSchema,
			Output: s.OutputSchema,
		}
	}
	return manifestSchema{Version: "0.1.0", Procedures: procs}
}

// --- manifest handler ---

func (s *appState) handleManifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write(s.manifestJSON)
}

// --- RPC handler ---

func (s *appState) handleRPC(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")

	// Batch endpoint: hash matches the batch hash from rpc-hash-map.json
	if s.batchHash != "" && name == s.batchHash {
		s.handleBatch(w, r)
		return
	}

	// Resolve hash -> original name when hash map is present
	if s.hashToName != nil {
		resolved, ok := s.hashToName[name]
		if !ok {
			writeError(w, http.StatusNotFound, NotFoundError(fmt.Sprintf("Procedure '%s' not found", name)))
			return
		}
		name = resolved
	}

	proc, ok := s.handlers[name]
	if !ok {
		writeError(w, http.StatusNotFound, NotFoundError(fmt.Sprintf("Procedure '%s' not found", name)))
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, ValidationError("Failed to read request body"))
		return
	}

	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, ValidationError("Invalid JSON"))
		return
	}

	ctx := r.Context()
	if s.opts.RPCTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.opts.RPCTimeout)
		defer cancel()
	}

	result, err := proc.Handler(ctx, body)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			writeError(w, http.StatusGatewayTimeout, NewError("INTERNAL_ERROR", "RPC timed out", http.StatusGatewayTimeout))
			return
		}
		if seamErr, ok := err.(*Error); ok {
			status := errorHTTPStatus(seamErr)
			writeError(w, status, seamErr)
		} else {
			writeError(w, http.StatusInternalServerError, InternalError(err.Error()))
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// --- batch RPC handler ---

type batchRequest struct {
	Calls []batchCall `json:"calls"`
}

type batchCall struct {
	Procedure string          `json:"procedure"`
	Input     json.RawMessage `json:"input"`
}

type batchResult struct {
	Data  any  `json:"data,omitempty"`
	Error *Error `json:"error,omitempty"`
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
				results[i] = batchResult{Error: NotFoundError(fmt.Sprintf("Procedure '%s' not found", name))}
				continue
			}
			name = resolved
		}

		proc, ok := s.handlers[name]
		if !ok {
			results[i] = batchResult{Error: NotFoundError(fmt.Sprintf("Procedure '%s' not found", name))}
			continue
		}

		input := call.Input
		if len(input) == 0 {
			input = json.RawMessage("{}")
		}

		result, err := proc.Handler(ctx, input)
		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				results[i] = batchResult{Error: NewError("INTERNAL_ERROR", "RPC timed out", http.StatusGatewayTimeout)}
				continue
			}
			if seamErr, ok := err.(*Error); ok {
				results[i] = batchResult{Error: seamErr}
			} else {
				results[i] = batchResult{Error: InternalError(err.Error())}
			}
			continue
		}
		results[i] = batchResult{Data: result}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

// --- subscribe handler ---

func (s *appState) handleSubscribe(w http.ResponseWriter, r *http.Request) {
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

// --- page handler ---

func (s *appState) makePageHandler(page *PageDef) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.servePage(w, r, page)
	}
}

func (s *appState) servePage(w http.ResponseWriter, r *http.Request, page *PageDef) {
	params := extractParams(page.Route, r)

	ctx := r.Context()
	if s.opts.PageTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.opts.PageTimeout)
		defer cancel()
	}

	// Run loaders concurrently
	type loaderResult struct {
		key   string
		value any
		err   error
	}

	var wg sync.WaitGroup
	results := make(chan loaderResult, len(page.Loaders))

	for _, loader := range page.Loaders {
		wg.Add(1)
		go func(ld LoaderDef) {
			defer wg.Done()
			input := ld.InputFn(params)
			inputJSON, err := json.Marshal(input)
			if err != nil {
				results <- loaderResult{key: ld.DataKey, err: err}
				return
			}

			proc, ok := s.handlers[ld.Procedure]
			if !ok {
				results <- loaderResult{key: ld.DataKey, err: InternalError(fmt.Sprintf("Procedure '%s' not found", ld.Procedure))}
				return
			}

			result, err := proc.Handler(ctx, inputJSON)
			results <- loaderResult{key: ld.DataKey, value: result, err: err}
		}(loader)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect loader results, sorted for deterministic output
	data := make(map[string]any)
	for res := range results {
		if res.err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				writeError(w, http.StatusGatewayTimeout, NewError("INTERNAL_ERROR", "Page loader timed out", http.StatusGatewayTimeout))
				return
			}
			if seamErr, ok := res.err.(*Error); ok {
				status := errorHTTPStatus(seamErr)
				writeError(w, status, seamErr)
			} else {
				writeError(w, http.StatusInternalServerError, InternalError(res.err.Error()))
			}
			return
		}
		data[res.key] = res.value
	}

	// Sort keys for deterministic JSON
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	orderedData := make(map[string]any)
	for _, k := range keys {
		orderedData[k] = data[k]
	}

	dataJSON, err := json.Marshal(orderedData)
	if err != nil {
		writeError(w, http.StatusInternalServerError, InternalError("Failed to serialize page data"))
		return
	}

	html, err := injector.Inject(page.Template, string(dataJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, InternalError(fmt.Sprintf("Template injection failed: %v", err)))
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(html))
}

// --- helpers ---

func extractParams(seamRoute string, r *http.Request) map[string]string {
	params := make(map[string]string)
	parts := strings.Split(seamRoute, "/")
	for _, p := range parts {
		if strings.HasPrefix(p, ":") {
			name := p[1:]
			params[name] = r.PathValue(name)
		}
	}
	return params
}

func writeError(w http.ResponseWriter, status int, e *Error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{
			"code":    e.Code,
			"message": e.Message,
		},
	})
}

func writeSSEEvent(w http.ResponseWriter, ev SubscriptionEvent) {
	if ev.Err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", mustJSON(map[string]string{
			"code": ev.Err.Code, "message": ev.Err.Message,
		}))
	} else {
		fmt.Fprintf(w, "event: data\ndata: %s\n\n", mustJSON(ev.Value))
	}
}

func writeSSEError(w http.ResponseWriter, e *Error) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	fmt.Fprintf(w, "event: error\ndata: %s\n\n", mustJSON(map[string]string{
		"code": e.Code, "message": e.Message,
	}))
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func errorHTTPStatus(e *Error) int {
	if e.Status != 0 {
		return e.Status
	}
	return defaultStatus(e.Code)
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
