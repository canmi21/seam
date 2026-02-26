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
	Default string `json:"default"`
}

type layoutEntry struct {
	Template  string            `json:"template"`
	Templates map[string]string `json:"templates"`
	Loaders   json.RawMessage   `json:"loaders"`
	Parent    string            `json:"parent"`
}

type routeEntry struct {
	Template  string            `json:"template"`
	Templates map[string]string `json:"templates"`
	Layout    string            `json:"layout"`
	Loaders   json.RawMessage   `json:"loaders"`
	HeadMeta  string            `json:"head_meta"`
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

	// Load layout templates
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
			if entry.HeadMeta != "" {
				template = strings.Replace(template, "</head>", entry.HeadMeta+"</head>", 1)
			}
		}

		// Collect loaders: layout chain loaders + route loaders
		var allLoaders []LoaderDef
		if entry.Layout != "" {
			current := entry.Layout
			for current != "" {
				if le, ok := manifest.Layouts[current]; ok {
					allLoaders = append(allLoaders, parseLoaders(le.Loaders)...)
					current = le.Parent
				} else {
					break
				}
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
			dataID = "__SEAM_DATA__"
		}
		pages = append(pages, PageDef{
			Route:          routePath,
			Template:       template,
			Loaders:        allLoaders,
			DataID:         dataID,
			LayoutID:       entry.Layout,
			PageLoaderKeys: pageLoaderKeys,
		})
	}

	return pages, nil
}
