/* packages/server/core/go/resolve.go */

package seam

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// ResolveLocaleFunc determines the content locale from request context.
type ResolveLocaleFunc func(r *http.Request, pathLocale string, locales []string, defaultLocale string) string

// DefaultResolveLocale resolves locale via: pathLocale -> cookie("seam-locale") -> Accept-Language -> defaultLocale
func DefaultResolveLocale(r *http.Request, pathLocale string, locales []string, defaultLocale string) string {
	if pathLocale != "" {
		return pathLocale
	}

	localeSet := make(map[string]bool, len(locales))
	for _, l := range locales {
		localeSet[l] = true
	}

	if loc := parseCookieLocale(r, "seam-locale", localeSet); loc != "" {
		return loc
	}

	if loc := parseAcceptLanguage(r.Header.Get("Accept-Language"), localeSet); loc != "" {
		return loc
	}

	return defaultLocale
}

func parseCookieLocale(r *http.Request, name string, localeSet map[string]bool) string {
	cookie, err := r.Cookie(name)
	if err != nil || cookie.Value == "" {
		return ""
	}
	if localeSet[cookie.Value] {
		return cookie.Value
	}
	return ""
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
