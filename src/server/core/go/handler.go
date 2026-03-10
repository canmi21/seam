/* src/server/core/go/handler.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
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
	prerenderPages        map[string]*PageDef // route -> page (prerender only)
}

func buildHandler(procedures []ProcedureDef, subscriptions []SubscriptionDef, streams []StreamDef, uploads []UploadDef, channels []ChannelDef, pages []PageDef, rpcHashMap *RpcHashMap, i18nConfig *I18nConfig, publicDir string, strategies []ResolveStrategy, contextConfigs map[string]ContextConfig, opts HandlerOptions, validationMode ValidationMode) http.Handler {
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
		state.hashToName["seam.i18n.query"] = "seam.i18n.query"
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

	state.registerProcedures(procedures, subscriptions, streams, uploads)

	// Register built-in seam.i18n.query procedure when i18n is configured
	if i18nConfig != nil {
		i18nCfg := i18nConfig
		validLocales := state.localeSet
		i18nQueryProc := ProcedureDef{
			Name:         "seam.i18n.query",
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
				locale := req.Locale
				if !validLocales[locale] {
					locale = i18nCfg.Default
				}
				messages := lookupI18nMessages(i18nCfg, req.Route, locale)
				result := map[string]json.RawMessage{
					"messages": messages,
				}
				// Include content hash when available
				if localeHashes, ok := i18nCfg.ContentHashes[req.Route]; ok {
					if hash, ok := localeHashes[locale]; ok {
						hashJSON, _ := json.Marshal(hash)
						result["hash"] = json.RawMessage(hashJSON)
					}
				}
				return result, nil
			},
		}
		state.handlers["seam.i18n.query"] = &i18nQueryProc
	}

	state.shouldValidate = shouldValidateMode(validationMode)
	if state.shouldValidate {
		state.compileValidationSchemas()
	}

	// Collect prerender page info for data endpoint
	prerenderPages := make(map[string]*PageDef)
	for i := range pages {
		if pages[i].Prerender && pages[i].StaticDir != "" {
			prerenderPages[pages[i].Route] = &pages[i]
		}
	}
	state.prerenderPages = prerenderPages

	mux := http.NewServeMux()
	mux.HandleFunc("GET /_seam/manifest.json", state.handleManifest)
	mux.HandleFunc("POST /_seam/procedure/{name}", state.handleRPC)
	mux.HandleFunc("GET /_seam/procedure/{name}", state.handleSubscribe)
	mux.HandleFunc("GET /_seam/data/{path...}", state.handlePageData)

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

	if publicDir != "" {
		return &publicFileHandler{mux: mux, dir: publicDir}
	}
	return mux
}

// publicFileHandler wraps a mux and serves static public files for
// non-/_seam/ GET requests before falling through to the mux.
type publicFileHandler struct {
	mux http.Handler
	dir string
}

func (h *publicFileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/_seam/") && r.Method == http.MethodGet {
		clean := filepath.Clean(r.URL.Path)
		if !strings.Contains(clean, "..") {
			full := filepath.Join(h.dir, clean)
			if info, err := os.Stat(full); err == nil && !info.IsDir() {
				w.Header().Set("Cache-Control", "public, max-age=3600")
				http.ServeFile(w, r, full)
				return
			}
		}
	}
	h.mux.ServeHTTP(w, r)
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

// --- registration helpers ---

// registerProcedures populates handler/sub/stream/upload maps and builds
// the kindMap used by the POST dispatcher. Panics on reserved "seam." prefix.
func (s *appState) registerProcedures(procedures []ProcedureDef, subscriptions []SubscriptionDef, streams []StreamDef, uploads []UploadDef) {
	for i := range procedures {
		if strings.HasPrefix(procedures[i].Name, "seam.") {
			panic(fmt.Sprintf("procedure name %q uses reserved \"seam.\" namespace", procedures[i].Name))
		}
		s.handlers[procedures[i].Name] = &procedures[i]
	}
	for i := range subscriptions {
		if strings.HasPrefix(subscriptions[i].Name, "seam.") {
			panic(fmt.Sprintf("subscription name %q uses reserved \"seam.\" namespace", subscriptions[i].Name))
		}
		s.subs[subscriptions[i].Name] = &subscriptions[i]
	}

	s.streams = make(map[string]*StreamDef)
	for i := range streams {
		if strings.HasPrefix(streams[i].Name, "seam.") {
			panic(fmt.Sprintf("stream name %q uses reserved \"seam.\" namespace", streams[i].Name))
		}
		s.streams[streams[i].Name] = &streams[i]
	}
	s.uploads = make(map[string]*UploadDef)
	for i := range uploads {
		if strings.HasPrefix(uploads[i].Name, "seam.") {
			panic(fmt.Sprintf("upload name %q uses reserved \"seam.\" namespace", uploads[i].Name))
		}
		s.uploads[uploads[i].Name] = &uploads[i]
	}

	// Build kind map for POST dispatcher
	s.kindMap = make(map[string]string)
	for name, p := range s.handlers {
		if p.Type == "command" {
			s.kindMap[name] = "command"
		} else {
			s.kindMap[name] = "query"
		}
	}
	for name := range s.streams {
		s.kindMap[name] = "stream"
	}
	for name := range s.uploads {
		s.kindMap[name] = "upload"
	}
}

// compileValidationSchemas pre-compiles JTD schemas for all registered
// procedures, subscriptions, streams, and uploads.
func (s *appState) compileValidationSchemas() {
	s.compiledInputSchemas = make(map[string]*compiledSchema)
	for name, proc := range s.handlers {
		if cs, err := compileSchema(proc.InputSchema); err == nil {
			s.compiledInputSchemas[name] = cs
		}
	}
	s.compiledSubSchemas = make(map[string]*compiledSchema)
	for name, sub := range s.subs {
		if cs, err := compileSchema(sub.InputSchema); err == nil {
			s.compiledSubSchemas[name] = cs
		}
	}
	s.compiledStreamSchemas = make(map[string]*compiledSchema)
	for name, st := range s.streams {
		if cs, err := compileSchema(st.InputSchema); err == nil {
			s.compiledStreamSchemas[name] = cs
		}
	}
	s.compiledUploadSchemas = make(map[string]*compiledSchema)
	for name, u := range s.uploads {
		if cs, err := compileSchema(u.InputSchema); err == nil {
			s.compiledUploadSchemas[name] = cs
		}
	}
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

// --- page data handler ---

func (s *appState) handlePageData(w http.ResponseWriter, r *http.Request) {
	rawPath := r.PathValue("path")
	pagePath := "/" + strings.TrimSuffix(rawPath, "/")

	// Find a prerendered page matching this path
	for _, page := range s.prerenderPages {
		if page.StaticDir == "" {
			continue
		}
		subPath := pagePath
		if subPath == "/" {
			subPath = ""
		}
		dataPath := filepath.Join(page.StaticDir, subPath, "__data.json")
		data, err := os.ReadFile(dataPath)
		if err != nil {
			continue
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)
		return
	}

	writeError(w, http.StatusNotFound, NotFoundError("Page data not found"))
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
