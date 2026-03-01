/* packages/server/core/go/build_loader.go */

// Load page definitions from seam build output on disk.
// Reads route-manifest.json, loads templates, constructs PageDef with loaders.

package seam

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type routeManifest struct {
	Layouts map[string]layoutEntry `json:"layouts"`
	Routes  map[string]routeEntry  `json:"routes"`
	DataID  string                 `json:"data_id"`
	I18n    *i18nManifest          `json:"i18n"`
}

type i18nManifest struct {
	Locales       []string                       `json:"locales"`
	Default       string                         `json:"default"`
	Mode          string                         `json:"mode"`
	Cache         bool                           `json:"cache"`
	RouteHashes   map[string]string              `json:"route_hashes"`
	ContentHashes map[string]map[string]string   `json:"content_hashes"`
}

type layoutEntry struct {
	Template  string            `json:"template"`
	Templates map[string]string `json:"templates"`
	Loaders   json.RawMessage   `json:"loaders"`
	Parent    string            `json:"parent"`
	I18nKeys  []string          `json:"i18n_keys"`
}

type routeEntry struct {
	Template  string            `json:"template"`
	Templates map[string]string `json:"templates"`
	Layout    string            `json:"layout"`
	Loaders   json.RawMessage   `json:"loaders"`
	HeadMeta  string            `json:"head_meta"`
	I18nKeys  []string          `json:"i18n_keys"`
}

// pickTemplate returns the template path: prefer singular "template",
// fall back to default locale, then any first value from "templates".
func pickTemplate(single string, multi map[string]string, defaultLocale string) string {
	if single != "" {
		return single
	}
	if multi != nil {
		if defaultLocale != "" {
			if t, ok := multi[defaultLocale]; ok {
				return t
			}
		}
		for _, t := range multi {
			return t
		}
	}
	return ""
}

type loaderConfig struct {
	Procedure string                     `json:"procedure"`
	Params    map[string]loaderParamConf `json:"params"`
}

type loaderParamConf struct {
	From string `json:"from"`
	Type string `json:"type"`
}

func parseLoaders(raw json.RawMessage) []LoaderDef {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var obj map[string]loaderConfig
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}

	var loaders []LoaderDef
	for dataKey, cfg := range obj {
		proc := cfg.Procedure
		params := cfg.Params
		loaders = append(loaders, LoaderDef{
			DataKey:   dataKey,
			Procedure: proc,
			InputFn:   buildInputFn(params),
		})
	}
	return loaders
}

func buildInputFn(params map[string]loaderParamConf) func(map[string]string) any {
	return func(routeParams map[string]string) any {
		obj := make(map[string]any)
		for key, cfg := range params {
			if cfg.From == "route" {
				obj[key] = routeParams[key]
			}
		}
		return obj
	}
}

// resolveLayoutChain walks from child to root, nesting page content inside layout templates.
func resolveLayoutChain(layoutID, pageTemplate string, layouts map[string]layoutResolved) string {
	result := pageTemplate
	current := layoutID

	for current != "" {
		lr, ok := layouts[current]
		if !ok {
			break
		}
		result = strings.Replace(lr.template, "<!--seam:outlet-->", result, 1)
		current = lr.parent
	}

	return result
}

type layoutResolved struct {
	template string
	parent   string
}

// RpcHashMap maps hashed procedure names back to originals.
type RpcHashMap struct {
	Salt       string            `json:"salt"`
	Batch      string            `json:"batch"`
	Procedures map[string]string `json:"procedures"`
}

// ReverseLookup builds hash -> original name map.
func (m *RpcHashMap) ReverseLookup() map[string]string {
	rev := make(map[string]string, len(m.Procedures))
	for name, hash := range m.Procedures {
		rev[hash] = name
	}
	return rev
}

// LoadRpcHashMap loads the RPC hash map from build output (returns nil when not present).
func LoadRpcHashMap(dir string) *RpcHashMap {
	data, err := os.ReadFile(filepath.Join(dir, "rpc-hash-map.json"))
	if err != nil {
		return nil
	}
	var m RpcHashMap
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	return &m
}

// LoadBuildOutput loads page definitions from seam build output on disk.
func LoadBuildOutput(dir string) ([]PageDef, error) {
	manifestPath := filepath.Join(dir, "route-manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("read route-manifest.json: %w", err)
	}

	var manifest routeManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parse route-manifest.json: %w", err)
	}

	defaultLocale := ""
	if manifest.I18n != nil {
		defaultLocale = manifest.I18n.Default
	}

	// Load layout templates (default locale)
	layouts := make(map[string]layoutResolved)
	for id, entry := range manifest.Layouts {
		tmplPath := pickTemplate(entry.Template, entry.Templates, defaultLocale)
		if tmplPath == "" {
			continue
		}
		tmplBytes, err := os.ReadFile(filepath.Join(dir, tmplPath))
		if err != nil {
			return nil, fmt.Errorf("read layout template %s: %w", tmplPath, err)
		}
		layouts[id] = layoutResolved{template: string(tmplBytes), parent: entry.Parent}
	}

	// Load layout templates per locale for locale-specific resolution
	// layoutLocaleTemplates[locale][layoutID] = layoutResolved
	layoutLocaleTemplates := make(map[string]map[string]layoutResolved)
	if manifest.I18n != nil {
		for id, entry := range manifest.Layouts {
			if entry.Templates == nil {
				continue
			}
			for locale, tmplPath := range entry.Templates {
				tmplBytes, err := os.ReadFile(filepath.Join(dir, tmplPath))
				if err != nil {
					return nil, fmt.Errorf("read layout locale template %s: %w", tmplPath, err)
				}
				if layoutLocaleTemplates[locale] == nil {
					layoutLocaleTemplates[locale] = make(map[string]layoutResolved)
				}
				layoutLocaleTemplates[locale][id] = layoutResolved{
					template: string(tmplBytes),
					parent:   entry.Parent,
				}
			}
		}
	}

	var pages []PageDef

	for routePath, entry := range manifest.Routes {
		tmplPath := pickTemplate(entry.Template, entry.Templates, defaultLocale)
		if tmplPath == "" {
			continue
		}
		tmplBytes, err := os.ReadFile(filepath.Join(dir, tmplPath))
		if err != nil {
			return nil, fmt.Errorf("read route template %s: %w", tmplPath, err)
		}
		pageTemplate := string(tmplBytes)

		// Resolve layout chain
		template := pageTemplate
		if entry.Layout != "" {
			template = resolveLayoutChain(entry.Layout, pageTemplate, layouts)
		}

		// Build locale-specific pre-resolved templates when i18n is active
		var localeTemplates map[string]string
		if manifest.I18n != nil && entry.Templates != nil {
			localeTemplates = make(map[string]string)
			for locale, ltPath := range entry.Templates {
				ltBytes, err := os.ReadFile(filepath.Join(dir, ltPath))
				if err != nil {
					return nil, fmt.Errorf("read route locale template %s: %w", ltPath, err)
				}
				pageTmpl := string(ltBytes)
				resolved := pageTmpl
				if entry.Layout != "" {
					localeLayouts := layoutLocaleTemplates[locale]
					if localeLayouts == nil {
						localeLayouts = layouts
					}
					resolved = resolveLayoutChain(entry.Layout, pageTmpl, localeLayouts)
				}
				localeTemplates[locale] = resolved
			}
		}

		// Collect loaders: layout chain loaders + route loaders
		// Also build layout chain with per-layout loader key assignments
		var allLoaders []LoaderDef
		var layoutChain []LayoutChainEntry
		if entry.Layout != "" {
			current := entry.Layout
			for current != "" {
				if le, ok := manifest.Layouts[current]; ok {
					layoutLoaders := parseLoaders(le.Loaders)
					var loaderKeys []string
					for _, ld := range layoutLoaders {
						loaderKeys = append(loaderKeys, ld.DataKey)
					}
					layoutChain = append(layoutChain, LayoutChainEntry{ID: current, LoaderKeys: loaderKeys})
					allLoaders = append(allLoaders, layoutLoaders...)
					current = le.Parent
				} else {
					break
				}
			}
			// Reverse: walked inner->outer, want outer->inner (matching TS)
			for i, j := 0, len(layoutChain)-1; i < j; i, j = i+1, j-1 {
				layoutChain[i], layoutChain[j] = layoutChain[j], layoutChain[i]
			}
		}
		pageLoaders := parseLoaders(entry.Loaders)
		var pageLoaderKeys []string
		for _, ld := range pageLoaders {
			pageLoaderKeys = append(pageLoaderKeys, ld.DataKey)
		}
		allLoaders = append(allLoaders, pageLoaders...)

		dataID := manifest.DataID
		if dataID == "" {
			dataID = "__data"
		}
		// Merge i18n_keys from layout chain + route
		var i18nKeys []string
		if entry.Layout != "" {
			current := entry.Layout
			for current != "" {
				if le, ok := manifest.Layouts[current]; ok {
					i18nKeys = append(i18nKeys, le.I18nKeys...)
					current = le.Parent
				} else {
					break
				}
			}
		}
		i18nKeys = append(i18nKeys, entry.I18nKeys...)

		pages = append(pages, PageDef{
			Route:           routePath,
			Template:        template,
			LocaleTemplates: localeTemplates,
			Loaders:         allLoaders,
			DataID:          dataID,
			LayoutChain:     layoutChain,
			PageLoaderKeys:  pageLoaderKeys,
			I18nKeys:        i18nKeys,
			HeadMeta:        entry.HeadMeta,
		})
	}

	return pages, nil
}

// LoadI18nConfig loads i18n configuration and locale messages from build output.
// Returns nil when i18n is not configured.
func LoadI18nConfig(dir string) *I18nConfig {
	manifestData, err := os.ReadFile(filepath.Join(dir, "route-manifest.json"))
	if err != nil {
		return nil
	}
	var manifest routeManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil
	}
	if manifest.I18n == nil || len(manifest.I18n.Locales) == 0 {
		return nil
	}

	i18n := manifest.I18n
	mode := i18n.Mode
	if mode == "" {
		mode = "memory"
	}

	// Memory mode: preload route-keyed messages per locale from i18n/{locale}.json
	// Paged mode: store distDir for on-demand reads
	messages := make(map[string]map[string]json.RawMessage)
	distDir := ""

	if mode == "memory" {
		i18nDir := filepath.Join(dir, "i18n")
		for _, locale := range i18n.Locales {
			localePath := filepath.Join(i18nDir, locale+".json")
			data, err := os.ReadFile(localePath)
			if err != nil {
				messages[locale] = make(map[string]json.RawMessage)
				continue
			}
			var routeMessages map[string]json.RawMessage
			if err := json.Unmarshal(data, &routeMessages); err != nil {
				messages[locale] = make(map[string]json.RawMessage)
				continue
			}
			messages[locale] = routeMessages
		}
	} else {
		distDir = dir
	}

	return &I18nConfig{
		Locales:       i18n.Locales,
		Default:       i18n.Default,
		Mode:          mode,
		Cache:         i18n.Cache,
		RouteHashes:   i18n.RouteHashes,
		ContentHashes: i18n.ContentHashes,
		Messages:      messages,
		DistDir:       distDir,
	}
}
