/* tests/markdown-demo/page_test.go */

package markdown_demo

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

func getHTML(t *testing.T, url string) (statusCode int, body string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp.StatusCode, string(raw)
}

var seamDataRe = regexp.MustCompile(`<script id="__data" type="application/json">(.+?)</script>`)

func extractSeamData(t *testing.T, html string) map[string]any {
	t.Helper()
	matches := seamDataRe.FindStringSubmatch(html)
	if len(matches) < 2 {
		t.Fatalf("__data not found in HTML")
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(matches[1]), &data); err != nil {
		t.Fatalf("unmarshal __data: %v", err)
	}
	return data
}

func stripSeamData(html string) string {
	return seamDataRe.ReplaceAllString(html, "")
}

var expectedTitles = map[string]string{
	"typescript": "Markdown Demo (TypeScript + marked)",
	"rust":       "Markdown Demo (Rust + pulldown-cmark)",
	"go":         "Markdown Demo (Go + goldmark)",
}

func TestPageRenders(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			status, html := getHTML(t, b.BaseURL+"/_seam/page/")
			if status != 200 {
				t.Fatalf("status = %d, want 200\nbody: %s", status, html)
			}

			expectedTitle := expectedTitles[b.Name]

			t.Run("title injected in h1", func(t *testing.T) {
				if !strings.Contains(html, "<h1>"+expectedTitle+"</h1>") {
					t.Errorf("HTML missing <h1>%s</h1>", expectedTitle)
				}
			})

			t.Run("title injected in head", func(t *testing.T) {
				want := "<title>" + expectedTitle + " — Seam Markdown Demo</title>"
				if !strings.Contains(html, want) {
					t.Errorf("HTML missing %s", want)
				}
			})
		})
	}
}

func TestHtmlSlotRawInjection(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			_, html := getHTML(t, b.BaseURL+"/_seam/page/")
			stripped := stripSeamData(html)

			t.Run("raw HTML tags present", func(t *testing.T) {
				checks := []struct {
					name, pattern string
				}{
					{"bold", "<strong>Bold text</strong>"},
					{"italic", "<em>italic text</em>"},
					{"strikethrough", "<del>strikethrough</del>"},
					{"link", `href="https://github.com/canmi21/seam"`},
					{"code block", "<pre>"},
					{"blockquote", "<blockquote>"},
					{"horizontal rule", "<hr"},
					{"inline code", "<code>code</code>"},
				}
				for _, c := range checks {
					if !strings.Contains(stripped, c.pattern) {
						t.Errorf("missing %s: %s", c.name, c.pattern)
					}
				}
			})

			t.Run("not escaped", func(t *testing.T) {
				escaped := []string{
					"&lt;strong&gt;",
					"&lt;em&gt;",
					"&lt;del&gt;",
					"&lt;blockquote&gt;",
					"&lt;pre&gt;",
				}
				for _, e := range escaped {
					if strings.Contains(html, e) {
						t.Errorf("HTML contains escaped entity %s — :html slot not working", e)
					}
				}
			})

			t.Run("no unprocessed directives", func(t *testing.T) {
				if strings.Contains(html, "<!--seam:") {
					t.Error("HTML contains unprocessed seam directives")
				}
			})
		})
	}
}

func TestSeamData(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			_, html := getHTML(t, b.BaseURL+"/_seam/page/")
			data := extractSeamData(t, html)

			article, ok := data["article"].(map[string]any)
			if !ok {
				t.Fatalf("__data.article not an object: %v", data)
			}

			expectedTitle := expectedTitles[b.Name]
			if title, _ := article["title"].(string); title != expectedTitle {
				t.Errorf("article.title = %q, want %q", title, expectedTitle)
			}

			contentHtml, _ := article["contentHtml"].(string)
			if contentHtml == "" {
				t.Fatal("article.contentHtml is empty")
			}
			// contentHtml in __data is JSON-encoded; the value itself contains HTML tags
			if !strings.Contains(contentHtml, "<strong>") {
				t.Error("article.contentHtml missing <strong> tag")
			}
		})
	}
}
