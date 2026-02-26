/* packages/server/core/go/resolve_test.go */

package seam

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func makeRequest(cookie, acceptLanguage string) *http.Request {
	r := httptest.NewRequest("GET", "/", nil)
	if cookie != "" {
		r.Header.Set("Cookie", cookie)
	}
	if acceptLanguage != "" {
		r.Header.Set("Accept-Language", acceptLanguage)
	}
	return r
}

func TestDefaultResolveLocale(t *testing.T) {
	locales := []string{"en", "zh", "ja"}

	tests := []struct {
		name           string
		pathLocale     string
		cookie         string
		acceptLanguage string
		want           string
	}{
		{"pathLocale wins", "zh", "", "", "zh"},
		{"pathLocale beats cookie", "zh", "seam-locale=ja", "", "zh"},
		{"cookie resolves", "", "seam-locale=ja", "", "ja"},
		{"cookie beats Accept-Language", "", "seam-locale=ja", "zh", "ja"},
		{"Accept-Language resolves", "", "", "zh,en;q=0.5", "zh"},
		{"Accept-Language q-value priority", "", "", "en;q=0.5,zh;q=0.9", "zh"},
		{"Accept-Language prefix match zh-CN -> zh", "", "", "zh-CN,en;q=0.5", "zh"},
		{"unknown cookie falls through", "", "seam-locale=fr", "", "en"},
		{"unknown Accept-Language falls through", "", "", "fr,de", "en"},
		{"no input -> default", "", "", "", "en"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := makeRequest(tt.cookie, tt.acceptLanguage)
			got := DefaultResolveLocale(r, tt.pathLocale, locales, "en")
			if got != tt.want {
				t.Errorf("DefaultResolveLocale() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseCookieLocale(t *testing.T) {
	localeSet := map[string]bool{"en": true, "zh": true}

	t.Run("valid cookie", func(t *testing.T) {
		r := makeRequest("seam-locale=zh", "")
		got := parseCookieLocale(r, "seam-locale", localeSet)
		if got != "zh" {
			t.Errorf("got %q, want %q", got, "zh")
		}
	})

	t.Run("missing cookie", func(t *testing.T) {
		r := makeRequest("", "")
		got := parseCookieLocale(r, "seam-locale", localeSet)
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("invalid locale in cookie", func(t *testing.T) {
		r := makeRequest("seam-locale=fr", "")
		got := parseCookieLocale(r, "seam-locale", localeSet)
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})
}

func TestParseAcceptLanguage(t *testing.T) {
	localeSet := map[string]bool{"en": true, "zh": true, "ja": true}

	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"empty header", "", ""},
		{"exact match", "zh", "zh"},
		{"prefix match", "zh-CN", "zh"},
		{"q-value ordering", "en;q=0.5,ja;q=0.9,zh;q=0.1", "ja"},
		{"no match", "fr,de", ""},
		{"multiple with prefix", "fr,zh-TW;q=0.8,en;q=0.5", "zh"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseAcceptLanguage(tt.header, localeSet)
			if got != tt.want {
				t.Errorf("parseAcceptLanguage(%q) = %q, want %q", tt.header, got, tt.want)
			}
		})
	}
}
