/* src/server/core/go/handler.go */

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
	manifestJSON  []byte
	handlers      map[string]*ProcedureDef
	subs          map[string]*SubscriptionDef
	opts          HandlerOptions
	hashToName    map[string]string // reverse lookup: hash -> original name (nil if no hash map)
	batchHash     string            // batch endpoint hash (empty if no hash map)
	i18nConfig    *I18nConfig
	localeSet     map[string]bool   // O(1) lookup for valid locales
	strategies []ResolveStrategy
}

func buildHandler(procedures []ProcedureDef, subscriptions []SubscriptionDef, channels []ChannelDef, pages []PageDef, rpcHashMap *RpcHashMap, i18nConfig *I18nConfig, strategies []ResolveStrategy, opts HandlerOptions) http.Handler {
	state := &appState{
		handlers:   make(map[string]*ProcedureDef),
		subs:       make(map[string]*SubscriptionDef),
		opts:       opts,
		i18nConfig: i18nConfig,
	}

	if len(strategies) > 0 {
		state.strategies = strategies
	} else {
		state.strategies = DefaultStrategies()
	}

	if i18nConfig != nil {
		state.localeSet = make(map[string]bool, len(i18nConfig.Locales))
		for _, loc := range i18nConfig.Locales {
			state.localeSet[loc] = true
		}
	}

	if rpcHashMap != nil {
		state.hashToName = rpcHashMap.ReverseLookup()
		state.batchHash = rpcHashMap.Batch
		// Built-in procedures bypass hash obfuscation (identity mapping)
		state.hashToName["__seam_i18n_query"] = "__seam_i18n_query"
	}

	// Expand channels into Level 0 primitives
	var channelMetas map[string]channelMeta
	for _, ch := range channels {
		procs, subs, meta := ch.expand()
		procedures = append(procedures, procs...)
		subscriptions = append(subscriptions, subs...)
		if channelMetas == nil {
			channelMetas = make(map[string]channelMeta)
		}
		channelMetas[ch.Name] = meta
	}

	// Build manifest
	manifest := buildManifest(procedures, subscriptions, channelMetas)
	state.manifestJSON, _ = json.Marshal(manifest)

	for i := range procedures {
		state.handlers[procedures[i].Name] = &procedures[i]
	}
	for i := range subscriptions {
		state.subs[subscriptions[i].Name] = &subscriptions[i]
	}

	// Register built-in __seam_i18n_query procedure when i18n is configured
	if i18nConfig != nil {
		i18nCfg := i18nConfig
		i18nQueryProc := ProcedureDef{
			Name:         "__seam_i18n_query",
			InputSchema:  map[string]any{},
			OutputSchema: map[string]any{},
			Handler: func(ctx context.Context, input json.RawMessage) (any, error) {
				var req struct {
					Route  string `json:"route"`
					Locale string `json:"locale"`
				}
				if err := json.Unmarshal(input, &req); err != nil {
					return nil, ValidationError("Invalid input")
				}
				messages := lookupI18nMessages(i18nCfg, req.Route, req.Locale)
				result := map[string]json.RawMessage{
					"messages": messages,
				}
				// Include content hash when available
				if localeHashes, ok := i18nCfg.ContentHashes[req.Route]; ok {
					if hash, ok := localeHashes[req.Locale]; ok {
						hashJSON, _ := json.Marshal(hash)
						result["hash"] = json.RawMessage(hashJSON)
					}
				}
				return result, nil
			},
		}
		state.handlers["__seam_i18n_query"] = &i18nQueryProc
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /_seam/manifest.json", state.handleManifest)
	mux.HandleFunc("POST /_seam/procedure/{name}", state.handleRPC)
	mux.HandleFunc("GET /_seam/procedure/{name}", state.handleSubscribe)

	// Pages are served under /_seam/page/* prefix only.
	// Root-path serving (e.g. "/" or "/dashboard/:id") is the application's
	// responsibility — use http.Handler fallback (e.g. gin.NoRoute) to rewrite
	// paths to /_seam/page/*. See the github-dashboard go-gin example.
	// Check if url_prefix strategy is present for locale-prefixed routes
	hasUrlPrefix := false
	for _, s := range state.strategies {
		if s.Kind() == "url_prefix" {
			hasUrlPrefix = true
			break
		}
	}

	for i := range pages {
		goPattern := seamRouteToGoPattern(pages[i].Route)
		page := &pages[i]
		mux.HandleFunc("GET /_seam/page"+goPattern, state.makePageHandler(page))

		// Only register locale-prefixed routes when url_prefix strategy is present
		if i18nConfig != nil && hasUrlPrefix {
			localePattern := "GET /_seam/page/{_seam_locale}" + goPattern
			mux.HandleFunc(localePattern, state.makePageHandler(page))
		}
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
	Version    int                       `json:"version"`
	Procedures map[string]procedureEntry `json:"procedures"`
	Channels   map[string]channelMeta    `json:"channels,omitempty"`
}

type procedureEntry struct {
	Type   string `json:"type"`
	Input  any    `json:"input"`
	Output any    `json:"output"`
	Error  any    `json:"error,omitempty"`
}

func buildManifest(procedures []ProcedureDef, subscriptions []SubscriptionDef, channels map[string]channelMeta) manifestSchema {
	procs := make(map[string]procedureEntry)
	for _, p := range procedures {
		procType := p.Type
		if procType == "" {
			procType = "query"
		}
		procs[p.Name] = procedureEntry{
			Type:   procType,
			Input:  p.InputSchema,
			Output: p.OutputSchema,
			Error:  p.ErrorSchema,
		}
	}
	for _, s := range subscriptions {
		procs[s.Name] = procedureEntry{
			Type:   "subscription",
			Input:  s.InputSchema,
			Output: s.OutputSchema,
			Error:  s.ErrorSchema,
		}
	}
	m := manifestSchema{Version: 1, Procedures: procs}
	if len(channels) > 0 {
		m.Channels = channels
	}
	return m
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
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": result})
}

// --- helpers ---

func writeError(w http.ResponseWriter, status int, e *Error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"ok": false,
		"error": map[string]any{
			"code":      e.Code,
			"message":   e.Message,
			"transient": false,
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