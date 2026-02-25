/* packages/server/core/go/handler.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
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

// --- helpers ---

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
