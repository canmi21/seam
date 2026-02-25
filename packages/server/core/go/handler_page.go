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

	html, err := injector.InjectNoScript(page.Template, string(dataJSON))
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

	dataID := page.DataID
	if dataID == "" {
		dataID = "__SEAM_DATA__"
	}
	scriptJSON, _ := json.Marshal(scriptData)
	script := fmt.Sprintf(`<script id="%s" type="application/json">%s</script>`, dataID, string(scriptJSON))
	if idx := strings.LastIndex(html, "</body>"); idx != -1 {
		html = html[:idx] + script + html[idx:]
	} else {
		html += script
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
