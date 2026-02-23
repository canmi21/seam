/* packages/server/core/go/handler.go */

package seam

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"

	injector "github.com/canmi21/seam/packages/server/injector/go"
)

type appState struct {
	manifestJSON []byte
	handlers     map[string]*ProcedureDef
	subs         map[string]*SubscriptionDef
}

func buildHandler(procedures []ProcedureDef, subscriptions []SubscriptionDef, pages []PageDef) http.Handler {
	state := &appState{
		handlers: make(map[string]*ProcedureDef),
		subs:     make(map[string]*SubscriptionDef),
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

	result, err := proc.Handler(r.Context(), body)
	if err != nil {
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

	for ev := range ch {
		if ev.Err != nil {
			fmt.Fprintf(w, "event: error\ndata: %s\n\n", mustJSON(map[string]string{
				"code": ev.Err.Code, "message": ev.Err.Message,
			}))
		} else {
			fmt.Fprintf(w, "event: data\ndata: %s\n\n", mustJSON(ev.Value))
		}
		if canFlush {
			flusher.Flush()
		}
	}

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

			result, err := proc.Handler(r.Context(), inputJSON)
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
	switch e.Code {
	case "VALIDATION_ERROR":
		return http.StatusBadRequest
	case "NOT_FOUND":
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
