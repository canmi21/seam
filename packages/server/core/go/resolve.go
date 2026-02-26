/* packages/server/core/go/resolve.go */

package seam

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// ResolveStrategy determines locale from request data.
type ResolveStrategy interface {
	Kind() string
	Resolve(data *ResolveData) string // "" means no match
}

// ResolveData carries request-scoped data for locale resolution.
type ResolveData struct {
	Request       *http.Request
	PathLocale    string
	Locales       []string
	DefaultLocale string
}

// ResolveChain runs strategies in order, returning the first non-empty result.
// Falls back to data.DefaultLocale when no strategy matches.
func ResolveChain(strategies []ResolveStrategy, data *ResolveData) string {
	for _, s := range strategies {
		if locale := s.Resolve(data); locale != "" {
			return locale
		}
	}
	return data.DefaultLocale
}

// DefaultStrategies returns the default resolution chain:
// url_prefix -> cookie("seam-locale") -> accept_language
func DefaultStrategies() []ResolveStrategy {
	return []ResolveStrategy{
		FromUrlPrefix(),
		FromCookie("seam-locale"),
		FromAcceptLanguage(),
	}
}

// --- url_prefix strategy ---

type urlPrefixStrategy struct{}

func FromUrlPrefix() ResolveStrategy { return urlPrefixStrategy{} }

func (urlPrefixStrategy) Kind() string { return "url_prefix" }

func (urlPrefixStrategy) Resolve(data *ResolveData) string {
	if data.PathLocale == "" {
		return ""
	}
	set := buildLocaleSet(data.Locales)
	if set[data.PathLocale] {
		return data.PathLocale
	}
	return ""
}

// --- cookie strategy ---

type cookieStrategy struct {
	name string
}

func FromCookie(name string) ResolveStrategy { return cookieStrategy{name: name} }

func (cookieStrategy) Kind() string { return "cookie" }

func (s cookieStrategy) Resolve(data *ResolveData) string {
	cookie, err := data.Request.Cookie(s.name)
	if err != nil || cookie.Value == "" {
		return ""
	}
	set := buildLocaleSet(data.Locales)
	if set[cookie.Value] {
		return cookie.Value
	}
	return ""
}

// --- accept_language strategy ---

type acceptLanguageStrategy struct{}

func FromAcceptLanguage() ResolveStrategy { return acceptLanguageStrategy{} }

func (acceptLanguageStrategy) Kind() string { return "accept_language" }

func (acceptLanguageStrategy) Resolve(data *ResolveData) string {
	header := data.Request.Header.Get("Accept-Language")
	if header == "" {
		return ""
	}
	set := buildLocaleSet(data.Locales)
	return parseAcceptLanguage(header, set)
}

// --- url_query strategy ---

type urlQueryStrategy struct {
	param string
}

func FromUrlQuery(param string) ResolveStrategy { return urlQueryStrategy{param: param} }

func (urlQueryStrategy) Kind() string { return "url_query" }

func (s urlQueryStrategy) Resolve(data *ResolveData) string {
	val := data.Request.URL.Query().Get(s.param)
	if val == "" {
		return ""
	}
	set := buildLocaleSet(data.Locales)
	if set[val] {
		return val
	}
	return ""
}

// --- backward-compatible function ---

// ResolveLocaleFunc determines the content locale from request context.
type ResolveLocaleFunc func(r *http.Request, pathLocale string, locales []string, defaultLocale string) string

// DefaultResolveLocale resolves locale via the default strategy chain.
func DefaultResolveLocale(r *http.Request, pathLocale string, locales []string, defaultLocale string) string {
	return ResolveChain(DefaultStrategies(), &ResolveData{
		Request:       r,
		PathLocale:    pathLocale,
		Locales:       locales,
		DefaultLocale: defaultLocale,
	})
}

// --- helpers ---

func buildLocaleSet(locales []string) map[string]bool {
	set := make(map[string]bool, len(locales))
	for _, l := range locales {
		set[l] = true
	}
	return set
}

func parseAcceptLanguage(header string, localeSet map[string]bool) string {
	if header == "" {
		return ""
	}

	type entry struct {
		lang string
		q    float64
	}
	var entries []entry

	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		segments := strings.Split(part, ";")
		lang := strings.TrimSpace(segments[0])
		q := 1.0
		for _, s := range segments[1:] {
			s = strings.TrimSpace(s)
			if strings.HasPrefix(s, "q=") {
				if v, err := strconv.ParseFloat(s[2:], 64); err == nil {
					q = v
				}
			}
		}
		entries = append(entries, entry{lang: lang, q: q})
	}

	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].q > entries[j].q
	})

	for _, e := range entries {
		if localeSet[e.lang] {
			return e.lang
		}
		// Prefix match: zh-CN -> zh
		if idx := strings.IndexByte(e.lang, '-'); idx > 0 {
			prefix := e.lang[:idx]
			if localeSet[prefix] {
				return prefix
			}
		}
	}

	return ""
}