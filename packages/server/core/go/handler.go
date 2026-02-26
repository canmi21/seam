/* packages/server/core/go/handler.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	engine "github.com/canmi21/seam/packages/server/engine/go"
)

type appState struct {
	manifestJSON  []byte
	handlers      map[string]*ProcedureDef
	subs          map[string]*SubscriptionDef
	opts          HandlerOptions
	hashToName    map[string]string // reverse lookup: hash -> original name (nil if no hash map)
	batchHash     string            // batch endpoint hash (empty if no hash map)
	i18nConfig    *I18nConfig
	localeSet     map[string]bool // O(1) lookup for valid locales
	resolveLocale ResolveLocaleFunc
}

func buildHandler(procedures []ProcedureDef, subscriptions []SubscriptionDef, pages []PageDef, rpcHashMap *RpcHashMap, i18nConfig *I18nConfig, resolveLocale ResolveLocaleFunc, opts HandlerOptions) http.Handler {
	state := &appState{
		handlers:   make(map[string]*ProcedureDef),
		subs:       make(map[string]*SubscriptionDef),
		opts:       opts,
		i18nConfig: i18nConfig,
	}

	// Set resolve function (default if nil)
	if resolveLocale != nil {
		state.resolveLocale = resolveLocale
	} else {
		state.resolveLocale = DefaultResolveLocale
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

	// Build manifest
	manifest := buildManifest(procedures, subscriptions)
	state.manifestJSON, _ = json.Marshal(manifest)

	for i := range procedures {
		state.handlers[procedures[i].Name] = &procedures[i]
	}
	for i := range subscriptions {
		state.subs[subscriptions[i].Name] = &subscriptions[i]
	}

	// Register built-in __seam_i18n_query procedure when i18n is configured
	if i18nConfig != nil {
		// Pre-build all-messages JSON for engine i18n_query calls
		allMessagesJSON, _ := json.Marshal(i18nConfig.Messages)
		defaultLocale := i18nConfig.Default
		i18nQueryProc := ProcedureDef{
			Name:         "__seam_i18n_query",
			InputSchema:  map[string]any{},
			OutputSchema: map[string]any{},
			Handler: func(ctx context.Context, input json.RawMessage) (any, error) {
				var req struct {
					Keys   []string `json:"keys"`
					Locale string   `json:"locale"`
				}
				if err := json.Unmarshal(input, &req); err != nil {
					return nil, ValidationError("Invalid input")
				}
				keysJSON, _ := json.Marshal(req.Keys)
				resultJSON, err := engine.I18nQuery(string(keysJSON), req.Locale, defaultLocale, string(allMessagesJSON))
				if err != nil {
					return nil, InternalError(err.Error())
				}
				var result any
				json.Unmarshal([]byte(resultJSON), &result)
				return result, nil
			},
		}
		state.handlers["__seam_i18n_query"] = &i18nQueryProc
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

		// Register locale-prefixed routes when i18n is active
		if i18nConfig != nil {
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
	ctx = context.WithValue(ctx, seamCtxKey{}, &SeamCtx{})
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
