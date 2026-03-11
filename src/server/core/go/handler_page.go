/* src/server/core/go/handler_page.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	engine "github.com/canmi21/seam/src/server/engine/go"
)

// --- page handler ---

func (s *appState) makePageHandler(page *PageDef) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.servePage(w, r, page)
	}
}

func (s *appState) servePage(w http.ResponseWriter, r *http.Request, page *PageDef) {
	// SSG short-circuit: serve pre-rendered HTML without loader execution
	if page.Prerender && page.StaticDir != "" {
		routePath := r.URL.Path
		// Strip /_seam/page prefix and optional locale prefix
		routePath = strings.TrimPrefix(routePath, "/_seam/page")
		if routePath == "" {
			routePath = "/"
		}
		subPath := routePath
		if subPath == "/" {
			subPath = ""
		}
		htmlPath := filepath.Join(page.StaticDir, subPath, "index.html")
		if data, err := os.ReadFile(htmlPath); err == nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(data)
			return
		}
		// Fall through to dynamic rendering (graceful degradation)
	}

	params := extractParams(page.Route, r)

	// Resolve locale when i18n is active
	var locale string
	if s.i18nConfig != nil {
		pathLocale := r.PathValue("_seam_locale")
		if pathLocale != "" && !s.localeSet[pathLocale] {
			writeError(w, http.StatusNotFound, NotFoundError("Unknown locale"))
			return
		}
		locale = ResolveChain(s.strategies, &ResolveData{
			Request:       r,
			PathLocale:    pathLocale,
			Locales:       s.i18nConfig.Locales,
			DefaultLocale: s.i18nConfig.Default,
		})
	}

	// Select locale-specific template (pre-resolved with layout chain)
	tmpl := page.Template
	if locale != "" && page.LocaleTemplates != nil {
		if lt, ok := page.LocaleTemplates[locale]; ok {
			tmpl = lt
		}
	}

	ctx := r.Context()
	if s.opts.PageTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.opts.PageTimeout)
		defer cancel()
	}

	// Run loaders concurrently
	type loaderResult struct {
		key       string
		value     any
		procedure string
		input     any
		err       error
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

			if s.shouldValidate {
				if cs, ok := s.compiledInputSchemas[ld.Procedure]; ok {
					var parsed any
					_ = json.Unmarshal(inputJSON, &parsed)
					if msg, details := validateCompiled(cs, parsed); msg != "" {
						results <- loaderResult{key: ld.DataKey, err: ValidationErrorDetailed(
							fmt.Sprintf("Input validation failed for procedure '%s': %s", ld.Procedure, msg), toAnySlice(details))}
						return
					}
				}
			}

			loaderCtx := ctx
			if len(s.contextConfigs) > 0 && len(proc.ContextKeys) > 0 {
				rawCtx := extractRawContext(r, s.contextConfigs)
				filtered := resolveContextForProc(rawCtx, proc.ContextKeys)
				loaderCtx = injectContext(loaderCtx, filtered)
			}
			loaderCtx = injectState(loaderCtx, s.appState)

			result, err := proc.Handler(loaderCtx, inputJSON)
			results <- loaderResult{key: ld.DataKey, value: result, procedure: ld.Procedure, input: input, err: err}
		}(loader)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect loader results with per-loader error boundary
	data := make(map[string]any)
	loaderMeta := make(map[string]any)
	for res := range results {
		if res.err != nil {
			// Shared context deadline = page-level error (all loaders affected)
			if ctx.Err() == context.DeadlineExceeded {
				writeError(w, http.StatusGatewayTimeout, NewError("INTERNAL_ERROR", "Page loader timed out", http.StatusGatewayTimeout))
				return
			}
			// Per-loader error boundary: error marker instead of aborting the page
			code := "INTERNAL_ERROR"
			message := res.err.Error()
			if seamErr, ok := res.err.(*Error); ok {
				code = seamErr.Code
				message = seamErr.Message
			}
			fmt.Fprintf(os.Stderr, "[seam] Loader %q failed: %v\n", res.key, res.err)
			data[res.key] = map[string]any{"__error": true, "code": code, "message": message}
			loaderMeta[res.key] = map[string]any{"procedure": res.procedure, "input": res.input, "error": true}
			continue
		}
		data[res.key] = res.value
		loaderMeta[res.key] = map[string]any{
			"procedure": res.procedure,
			"input":     res.input,
		}
	}

	// Prune to projected fields before template injection
	if len(page.Projections) > 0 {
		data = applyProjection(data, page.Projections)
	}

	// Marshal loader data to JSON (json.Marshal sorts map keys deterministically)
	loaderDataJSON, err := json.Marshal(data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, InternalError("Failed to serialize page data"))
		return
	}

	// Build page config for engine
	layoutChain := make([]map[string]any, 0, len(page.LayoutChain))
	for _, entry := range page.LayoutChain {
		layoutChain = append(layoutChain, map[string]any{
			"id":          entry.ID,
			"loader_keys": entry.LoaderKeys,
		})
	}
	dataID := page.DataID
	if dataID == "" {
		dataID = "__data"
	}
	config := map[string]any{
		"layout_chain":    layoutChain,
		"data_id":         dataID,
		"loader_metadata": loaderMeta,
	}
	if page.HeadMeta != "" {
		config["head_meta"] = page.HeadMeta
	}
	if page.Assets != nil {
		config["page_assets"] = page.Assets
	}
	configJSON, _ := json.Marshal(config)

	// Build i18n opts for engine (hash-based lookup: zero merge, zero filter)
	i18nOptsJSON := ""
	if s.i18nConfig != nil && locale != "" {
		routeHash := s.i18nConfig.RouteHashes[page.Route]
		messages := lookupI18nMessages(s.i18nConfig, routeHash, locale)
		i18nOpts := map[string]any{
			"locale":         locale,
			"default_locale": s.i18nConfig.Default,
			"messages":       messages,
		}
		// Add content hash when available
		if routeHash != "" {
			if localeHashes, ok := s.i18nConfig.ContentHashes[routeHash]; ok {
				if hash, ok := localeHashes[locale]; ok {
					i18nOpts["hash"] = hash
				}
			}
		}
		// Inject router table when cache is enabled
		if s.i18nConfig.Cache {
			i18nOpts["router"] = s.i18nConfig.ContentHashes
		}
		i18nBytes, _ := json.Marshal(i18nOpts)
		i18nOptsJSON = string(i18nBytes)
	}

	// Single WASM call: slot injection + data script + head meta + lang attribute
	html, err := engine.RenderPage(tmpl, string(loaderDataJSON), string(configJSON), i18nOptsJSON)
	if err != nil {
		writeError(w, http.StatusInternalServerError, InternalError(fmt.Sprintf("Page render failed: %v", err)))
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(html))
}

// lookupI18nMessages retrieves pre-resolved messages for a route+locale.
// Memory mode: direct map lookup. Paged mode: read from disk.
func lookupI18nMessages(cfg *I18nConfig, routeHash, locale string) json.RawMessage {
	if !isKnownLocale(cfg, locale) || !isKnownRouteHash(cfg, routeHash) {
		return json.RawMessage("{}")
	}
	if cfg.Mode == "paged" && cfg.DistDir != "" {
		path := filepath.Join(cfg.DistDir, "i18n", routeHash, locale+".json")
		data, err := os.ReadFile(path)
		if err != nil {
			return json.RawMessage("{}")
		}
		return json.RawMessage(data)
	}
	// Memory mode
	if localeMessages, ok := cfg.Messages[locale]; ok {
		if msgs, ok := localeMessages[routeHash]; ok {
			return msgs
		}
	}
	return json.RawMessage("{}")
}

func isKnownLocale(cfg *I18nConfig, locale string) bool {
	for _, candidate := range cfg.Locales {
		if candidate == locale {
			return true
		}
	}
	return false
}

func isKnownRouteHash(cfg *I18nConfig, routeHash string) bool {
	if routeHash == "" {
		return false
	}
	if _, ok := cfg.ContentHashes[routeHash]; ok {
		return true
	}
	for _, candidate := range cfg.RouteHashes {
		if candidate == routeHash {
			return true
		}
	}
	for _, localeMessages := range cfg.Messages {
		if _, ok := localeMessages[routeHash]; ok {
			return true
		}
	}
	return false
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
