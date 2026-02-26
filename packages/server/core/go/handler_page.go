/* packages/server/core/go/handler_page.go */

package seam

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"

	injector "github.com/canmi21/seam/packages/server/injector/go"
)

// --- page handler ---

func (s *appState) makePageHandler(page *PageDef) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.servePage(w, r, page)
	}
}

func (s *appState) servePage(w http.ResponseWriter, r *http.Request, page *PageDef) {
	params := extractParams(page.Route, r)

	// Extract locale from path params when i18n is active
	var locale string
	if s.i18nConfig != nil {
		loc := r.PathValue("_seam_locale")
		if loc != "" && s.localeSet[loc] {
			locale = loc
		} else if loc != "" {
			writeError(w, http.StatusNotFound, NotFoundError("Unknown locale"))
			return
		} else {
			locale = s.i18nConfig.Default
		}
	}

	// Select locale-specific template (pre-resolved with layout chain)
	tmpl := page.Template
	if locale != "" && page.LocaleTemplates != nil {
		if lt, ok := page.LocaleTemplates[locale]; ok {
			tmpl = lt
		}
	}

	ctx := r.Context()
	if locale != "" {
		ctx = context.WithValue(ctx, seamCtxKey{}, &SeamCtx{Locale: locale})
	}
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

	// Flatten keyed loader results for slot resolution: spread nested object
	// values to the top level so slots like <!--seam:tagline--> can resolve from
	// data like {page: {tagline: "..."}} (matching TS flattenForSlots).
	// JSON round-trip normalizes Go types (map[string]string -> map[string]any).
	rawJSON, err := json.Marshal(orderedData)
	if err != nil {
		writeError(w, http.StatusInternalServerError, InternalError("Failed to serialize page data"))
		return
	}
	var flatData map[string]any
	json.Unmarshal(rawJSON, &flatData)
	for _, v := range flatData {
		if nested, ok := v.(map[string]any); ok {
			for nk, nv := range nested {
				if _, exists := flatData[nk]; !exists {
					flatData[nk] = nv
				}
			}
		}
	}

	dataJSON, err := json.Marshal(flatData)
	if err != nil {
		writeError(w, http.StatusInternalServerError, InternalError("Failed to serialize page data"))
		return
	}

	html, err := injector.InjectNoScript(tmpl, string(dataJSON))
	if err != nil {
		writeError(w, http.StatusInternalServerError, InternalError(fmt.Sprintf("Template injection failed: %v", err)))
		return
	}

	// Build data script JSON: page data at top level, layout data under _layouts
	scriptData := orderedData
	if page.LayoutID != "" {
		pageKeys := make(map[string]bool)
		for _, k := range page.PageLoaderKeys {
			pageKeys[k] = true
		}
		layoutData := make(map[string]any)
		pageData := make(map[string]any)
		for k, v := range orderedData {
			if pageKeys[k] {
				pageData[k] = v
			} else {
				layoutData[k] = v
			}
		}
		scriptData = pageData
		if len(layoutData) > 0 {
			scriptData["_layouts"] = map[string]any{page.LayoutID: layoutData}
		}
	}

	// Inject _i18n data for client hydration
	if s.i18nConfig != nil && locale != "" {
		i18nData := map[string]any{
			"locale":   locale,
			"messages": filterI18nMessages(s.i18nConfig.Messages[locale], page.I18nKeys),
		}
		if locale != s.i18nConfig.Default {
			i18nData["fallbackMessages"] = filterI18nMessages(s.i18nConfig.Messages[s.i18nConfig.Default], page.I18nKeys)
		}
		if len(s.i18nConfig.Versions) > 0 {
			i18nData["versions"] = s.i18nConfig.Versions
		}
		scriptData["_i18n"] = i18nData
	}

	dataID := page.DataID
	if dataID == "" {
		dataID = "__SEAM_DATA__"
	}
	scriptJSON, _ := json.Marshal(scriptData)
	escaped := asciiEscapeJSON(string(scriptJSON))
	script := fmt.Sprintf(`<script id="%s" type="application/json">%s</script>`, dataID, escaped)
	if idx := strings.LastIndex(html, "</body>"); idx != -1 {
		html = html[:idx] + script + html[idx:]
	} else {
		html += script
	}

	// Set <html lang="..."> attribute
	if locale != "" {
		html = strings.Replace(html, "<html", fmt.Sprintf(`<html lang="%s"`, locale), 1)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(html))
}

// filterI18nMessages filters a locale's messages JSON to only include the specified keys.
// Empty keys list means include all messages (no filtering).
func filterI18nMessages(messages json.RawMessage, keys []string) json.RawMessage {
	if len(keys) == 0 {
		return messages
	}
	var allMessages map[string]json.RawMessage
	if err := json.Unmarshal(messages, &allMessages); err != nil {
		return messages
	}
	filtered := make(map[string]json.RawMessage, len(keys))
	for _, k := range keys {
		if v, ok := allMessages[k]; ok {
			filtered[k] = v
		}
	}
	result, _ := json.Marshal(filtered)
	return json.RawMessage(result)
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
