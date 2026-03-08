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
	manifestJSON          []byte
	handlers              map[string]*ProcedureDef
	subs                  map[string]*SubscriptionDef
	opts                  HandlerOptions
	hashToName            map[string]string // reverse lookup: hash -> original name (nil if no hash map)
	batchHash             string            // batch endpoint hash (empty if no hash map)
	i18nConfig            *I18nConfig
	localeSet             map[string]bool // O(1) lookup for valid locales
	strategies            []ResolveStrategy
	contextConfigs        map[string]ContextConfig
	streams               map[string]*StreamDef
	uploads               map[string]*UploadDef
	kindMap               map[string]string // name -> "query"|"command"|"stream"|"upload"
	shouldValidate        bool
	compiledInputSchemas  map[string]*compiledSchema
	compiledSubSchemas    map[string]*compiledSchema
	compiledStreamSchemas map[string]*compiledSchema
	compiledUploadSchemas map[string]*compiledSchema
}

func buildHandler(procedures []ProcedureDef, subscriptions []SubscriptionDef, streams []StreamDef, uploads []UploadDef, channels []ChannelDef, pages []PageDef, rpcHashMap *RpcHashMap, i18nConfig *I18nConfig, strategies []ResolveStrategy, contextConfigs map[string]ContextConfig, opts HandlerOptions, validationMode ValidationMode) http.Handler {
	state := &appState{
		handlers:       make(map[string]*ProcedureDef),
		subs:           make(map[string]*SubscriptionDef),
		opts:           opts,
		i18nConfig:     i18nConfig,
		contextConfigs: contextConfigs,
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
	manifest := buildManifest(procedures, subscriptions, streams, uploads, channelMetas, state.contextConfigs)
	state.manifestJSON, _ = json.Marshal(manifest)

	for i := range procedures {
		state.handlers[procedures[i].Name] = &procedures[i]
	}
	for i := range subscriptions {
		state.subs[subscriptions[i].Name] = &subscriptions[i]
	}

	state.streams = make(map[string]*StreamDef)
	for i := range streams {
		state.streams[streams[i].Name] = &streams[i]
	}
	state.uploads = make(map[string]*UploadDef)
	for i := range uploads {
		state.uploads[uploads[i].Name] = &uploads[i]
	}

	// Build kind map for POST dispatcher
	state.kindMap = make(map[string]string)
	for name, p := range state.handlers {
		if p.Type == "command" {
			state.kindMap[name] = "command"
		} else {
			state.kindMap[name] = "query"
		}
	}
	for name := range state.streams {
		state.kindMap[name] = "stream"
	}
	for name := range state.uploads {
		state.kindMap[name] = "upload"
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

	state.shouldValidate = shouldValidateMode(validationMode)
	if state.shouldValidate {
		state.compiledInputSchemas = make(map[string]*compiledSchema)
		for name, proc := range state.handlers {
			if cs, err := compileSchema(proc.InputSchema); err == nil {
				state.compiledInputSchemas[name] = cs
			}
		}
		state.compiledSubSchemas = make(map[string]*compiledSchema)
		for name, sub := range state.subs {
			if cs, err := compileSchema(sub.InputSchema); err == nil {
				state.compiledSubSchemas[name] = cs
			}
		}
		state.compiledStreamSchemas = make(map[string]*compiledSchema)
		for name, s := range state.streams {
			if cs, err := compileSchema(s.InputSchema); err == nil {
				state.compiledStreamSchemas[name] = cs
			}
		}
		state.compiledUploadSchemas = make(map[string]*compiledSchema)
		for name, u := range state.uploads {
			if cs, err := compileSchema(u.InputSchema); err == nil {
				state.compiledUploadSchemas[name] = cs
			}
		}
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
	Version           int                             `json:"version"`
	Context           map[string]contextManifestEntry `json:"context,omitempty"`
	Procedures        map[string]procedureEntry       `json:"procedures"`
	Channels          map[string]channelMeta          `json:"channels,omitempty"`
	TransportDefaults map[string]any                  `json:"transportDefaults"`
}

type contextManifestEntry struct {
	Extract string `json:"extract"`
}

type procedureEntry struct {
	Kind        string   `json:"kind"`
	Input       any      `json:"input"`
	Output      any      `json:"output,omitempty"`
	ChunkOutput any      `json:"chunkOutput,omitempty"`
	Error       any      `json:"error,omitempty"`
	Context     []string `json:"context,omitempty"`
}

func buildManifest(procedures []ProcedureDef, subscriptions []SubscriptionDef, streams []StreamDef, uploads []UploadDef, channels map[string]channelMeta, contextConfigs map[string]ContextConfig) manifestSchema {
	procs := make(map[string]procedureEntry)
	for _, p := range procedures {
		procType := p.Type
		if procType == "" {
			procType = "query"
		}
		entry := procedureEntry{
			Kind:   procType,
			Input:  p.InputSchema,
			Output: p.OutputSchema,
			Error:  p.ErrorSchema,
		}
		if len(p.ContextKeys) > 0 {
			entry.Context = p.ContextKeys
		}
		procs[p.Name] = entry
	}
	for _, s := range subscriptions {
		entry := procedureEntry{
			Kind:   "subscription",
			Input:  s.InputSchema,
			Output: s.OutputSchema,
			Error:  s.ErrorSchema,
		}
		if len(s.ContextKeys) > 0 {
			entry.Context = s.ContextKeys
		}
		procs[s.Name] = entry
	}
	for _, st := range streams {
		entry := procedureEntry{
			Kind:        "stream",
			Input:       st.InputSchema,
			ChunkOutput: st.ChunkOutputSchema,
			Error:       st.ErrorSchema,
		}
		if len(st.ContextKeys) > 0 {
			entry.Context = st.ContextKeys
		}
		procs[st.Name] = entry
	}
	for _, u := range uploads {
		entry := procedureEntry{
			Kind:   "upload",
			Input:  u.InputSchema,
			Output: u.OutputSchema,
			Error:  u.ErrorSchema,
		}
		if len(u.ContextKeys) > 0 {
			entry.Context = u.ContextKeys
		}
		procs[u.Name] = entry
	}
	m := manifestSchema{
		Version:           2,
		Procedures:        procs,
		TransportDefaults: make(map[string]any),
	}
	if len(channels) > 0 {
		m.Channels = channels
	}
	if len(contextConfigs) > 0 {
		ctxManifest := make(map[string]contextManifestEntry)
		for key, cfg := range contextConfigs {
			ctxManifest[key] = contextManifestEntry(cfg)
		}
		m.Context = ctxManifest
	}
	return m
}

// --- manifest handler ---

func (s *appState) handleManifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(s.manifestJSON)
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

	// Dispatch to stream/upload handlers based on kind
	if kind := s.kindMap[name]; kind == "stream" {
		s.handleStream(w, r, name)
		return
	} else if kind == "upload" {
		s.handleUpload(w, r, name)
		return
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
	// Inject context from headers
	if len(s.contextConfigs) > 0 && len(proc.ContextKeys) > 0 {
		rawCtx := extractRawContext(r, s.contextConfigs)
		filtered := resolveContextForProc(rawCtx, proc.ContextKeys)
		ctx = injectContext(ctx, filtered)
	}
	if s.opts.RPCTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.opts.RPCTimeout)
		defer cancel()
	}

	if s.shouldValidate {
		if cs, ok := s.compiledInputSchemas[name]; ok {
			var parsed any
			_ = json.Unmarshal(body, &parsed)
			if msg, details := validateCompiled(cs, parsed); msg != "" {
				writeError(w, 400, ValidationErrorDetailed(
					fmt.Sprintf("Input validation failed for procedure '%s': %s", name, msg), toAnySlice(details)))
				return
			}
		}
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
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": result})
}

// --- helpers ---

func writeError(w http.ResponseWriter, status int, e *Error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	errObj := map[string]any{
		"code":      e.Code,
		"message":   e.Message,
		"transient": false,
	}
	if e.Details != nil {
		errObj["details"] = e.Details
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":    false,
		"error": errObj,
	})
}

func errorHTTPStatus(e *Error) int {
	if e.Status != 0 {
		return e.Status
	}
	return defaultStatus(e.Code)
}

func toAnySlice(details []ValidationDetail) []any {
	result := make([]any, len(details))
	for i, d := range details {
		result[i] = d
	}
	return result
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
