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

// --- strategy unit tests ---

func TestFromUrlPrefix(t *testing.T) {
	locales := []string{"en", "zh", "ja"}

	t.Run("valid locale", func(t *testing.T) {
		s := FromUrlPrefix()
		got := s.Resolve(&ResolveData{
			Request:    httptest.NewRequest("GET", "/", nil),
			PathLocale: "zh",
			Locales:    locales,
		})
		if got != "zh" {
			t.Errorf("got %q, want %q", got, "zh")
		}
	})

	t.Run("invalid locale returns empty", func(t *testing.T) {
		s := FromUrlPrefix()
		got := s.Resolve(&ResolveData{
			Request:    httptest.NewRequest("GET", "/", nil),
			PathLocale: "fr",
			Locales:    locales,
		})
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("empty PathLocale returns empty", func(t *testing.T) {
		s := FromUrlPrefix()
		got := s.Resolve(&ResolveData{
			Request:    httptest.NewRequest("GET", "/", nil),
			PathLocale: "",
			Locales:    locales,
		})
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("kind is url_prefix", func(t *testing.T) {
		s := FromUrlPrefix()
		if s.Kind() != "url_prefix" {
			t.Errorf("Kind() = %q, want %q", s.Kind(), "url_prefix")
		}
	})
}

func TestFromCookie(t *testing.T) {
	locales := []string{"en", "zh", "ja"}

	t.Run("valid cookie", func(t *testing.T) {
		s := FromCookie("seam-locale")
		r := makeRequest("seam-locale=zh", "")
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "zh" {
			t.Errorf("got %q, want %q", got, "zh")
		}
	})

	t.Run("missing cookie", func(t *testing.T) {
		s := FromCookie("seam-locale")
		r := makeRequest("", "")
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("invalid locale in cookie", func(t *testing.T) {
		s := FromCookie("seam-locale")
		r := makeRequest("seam-locale=fr", "")
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("custom cookie name", func(t *testing.T) {
		s := FromCookie("my-lang")
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("Cookie", "my-lang=ja")
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "ja" {
			t.Errorf("got %q, want %q", got, "ja")
		}
	})

	t.Run("kind is cookie", func(t *testing.T) {
		s := FromCookie("seam-locale")
		if s.Kind() != "cookie" {
			t.Errorf("Kind() = %q, want %q", s.Kind(), "cookie")
		}
	})
}

func TestFromAcceptLanguageStrategy(t *testing.T) {
	locales := []string{"en", "zh", "ja"}

	t.Run("exact match", func(t *testing.T) {
		s := FromAcceptLanguage()
		r := makeRequest("", "zh")
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "zh" {
			t.Errorf("got %q, want %q", got, "zh")
		}
	})

	t.Run("prefix match zh-CN -> zh", func(t *testing.T) {
		s := FromAcceptLanguage()
		r := makeRequest("", "zh-CN")
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "zh" {
			t.Errorf("got %q, want %q", got, "zh")
		}
	})

	t.Run("q-value priority", func(t *testing.T) {
		s := FromAcceptLanguage()
		r := makeRequest("", "en;q=0.5,ja;q=0.9,zh;q=0.1")
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "ja" {
			t.Errorf("got %q, want %q", got, "ja")
		}
	})

	t.Run("no match returns empty", func(t *testing.T) {
		s := FromAcceptLanguage()
		r := makeRequest("", "fr,de")
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("empty header returns empty", func(t *testing.T) {
		s := FromAcceptLanguage()
		r := makeRequest("", "")
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("kind is accept_language", func(t *testing.T) {
		s := FromAcceptLanguage()
		if s.Kind() != "accept_language" {
			t.Errorf("Kind() = %q, want %q", s.Kind(), "accept_language")
		}
	})
}

func TestFromUrlQuery(t *testing.T) {
	locales := []string{"en", "zh", "ja"}

	t.Run("valid query param", func(t *testing.T) {
		s := FromUrlQuery("lang")
		r := httptest.NewRequest("GET", "/?lang=zh", nil)
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "zh" {
			t.Errorf("got %q, want %q", got, "zh")
		}
	})

	t.Run("missing query param", func(t *testing.T) {
		s := FromUrlQuery("lang")
		r := httptest.NewRequest("GET", "/", nil)
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("invalid locale in query", func(t *testing.T) {
		s := FromUrlQuery("lang")
		r := httptest.NewRequest("GET", "/?lang=fr", nil)
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("custom param name", func(t *testing.T) {
		s := FromUrlQuery("locale")
		r := httptest.NewRequest("GET", "/?locale=ja", nil)
		got := s.Resolve(&ResolveData{
			Request: r,
			Locales: locales,
		})
		if got != "ja" {
			t.Errorf("got %q, want %q", got, "ja")
		}
	})

	t.Run("kind is url_query", func(t *testing.T) {
		s := FromUrlQuery("lang")
		if s.Kind() != "url_query" {
			t.Errorf("Kind() = %q, want %q", s.Kind(), "url_query")
		}
	})
}

// --- chain tests ---

func TestResolveChain(t *testing.T) {
	locales := []string{"en", "zh", "ja"}

	t.Run("first match wins", func(t *testing.T) {
		r := makeRequest("seam-locale=ja", "zh")
		got := ResolveChain(
			[]ResolveStrategy{FromCookie("seam-locale"), FromAcceptLanguage()},
			&ResolveData{Request: r, Locales: locales, DefaultLocale: "en"},
		)
		if got != "ja" {
			t.Errorf("got %q, want %q", got, "ja")
		}
	})

	t.Run("skips non-matching strategies", func(t *testing.T) {
		r := makeRequest("", "zh")
		got := ResolveChain(
			[]ResolveStrategy{FromUrlPrefix(), FromCookie("seam-locale"), FromAcceptLanguage()},
			&ResolveData{Request: r, PathLocale: "", Locales: locales, DefaultLocale: "en"},
		)
		if got != "zh" {
			t.Errorf("got %q, want %q", got, "zh")
		}
	})

	t.Run("empty chain falls back to default", func(t *testing.T) {
		r := makeRequest("", "")
		got := ResolveChain(
			[]ResolveStrategy{},
			&ResolveData{Request: r, Locales: locales, DefaultLocale: "en"},
		)
		if got != "en" {
			t.Errorf("got %q, want %q", got, "en")
		}
	})

	t.Run("all strategies miss falls back to default", func(t *testing.T) {
		r := makeRequest("", "fr")
		got := ResolveChain(
			[]ResolveStrategy{FromUrlPrefix(), FromCookie("seam-locale"), FromAcceptLanguage()},
			&ResolveData{Request: r, PathLocale: "", Locales: locales, DefaultLocale: "en"},
		)
		if got != "en" {
			t.Errorf("got %q, want %q", got, "en")
		}
	})

	t.Run("custom chain composition", func(t *testing.T) {
		r := httptest.NewRequest("GET", "/?lang=ja", nil)
		got := ResolveChain(
			[]ResolveStrategy{FromUrlQuery("lang"), FromCookie("seam-locale")},
			&ResolveData{Request: r, Locales: locales, DefaultLocale: "en"},
		)
		if got != "ja" {
			t.Errorf("got %q, want %q", got, "ja")
		}
	})
}

func TestDefaultStrategies(t *testing.T) {
	strategies := DefaultStrategies()
	if len(strategies) != 3 {
		t.Fatalf("DefaultStrategies() returned %d strategies, want 3", len(strategies))
	}

	expected := []string{"url_prefix", "cookie", "accept_language"}
	for i, s := range strategies {
		if s.Kind() != expected[i] {
			t.Errorf("strategy[%d].Kind() = %q, want %q", i, s.Kind(), expected[i])
		}
	}
}

// --- backward-compat tests ---

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
	locales := []string{"en", "zh"}

	t.Run("valid cookie", func(t *testing.T) {
		r := makeRequest("seam-locale=zh", "")
		s := FromCookie("seam-locale")
		got := s.Resolve(&ResolveData{Request: r, Locales: locales})
		if got != "zh" {
			t.Errorf("got %q, want %q", got, "zh")
		}
	})

	t.Run("missing cookie", func(t *testing.T) {
		r := makeRequest("", "")
		s := FromCookie("seam-locale")
		got := s.Resolve(&ResolveData{Request: r, Locales: locales})
		if got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("invalid locale in cookie", func(t *testing.T) {
		r := makeRequest("seam-locale=fr", "")
		s := FromCookie("seam-locale")
		got := s.Resolve(&ResolveData{Request: r, Locales: locales})
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