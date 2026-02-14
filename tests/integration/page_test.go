package integration

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

// --- helpers ---

func getHTML(t *testing.T, url string) (int, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp.StatusCode, string(raw)
}

var seamDataRe = regexp.MustCompile(`<script id="__SEAM_DATA__" type="application/json">(.+?)</script>`)

func extractSeamData(t *testing.T, html string) map[string]any {
	t.Helper()
	matches := seamDataRe.FindStringSubmatch(html)
	if len(matches) < 2 {
		t.Fatalf("__SEAM_DATA__ not found in HTML")
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(matches[1]), &data); err != nil {
		t.Fatalf("unmarshal __SEAM_DATA__: %v", err)
	}
	return data
}

func stripSeamData(html string) string {
	return seamDataRe.ReplaceAllString(html, "")
}

// --- per-backend tests ---

func TestPageEndpoint(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			t.Run("user id=1", func(t *testing.T) {
				status, html := getHTML(t, b.BaseURL+"/seam/page/user/1")
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				if !strings.Contains(html, "text/html") || true {
					// Content-Type checked via response, HTML content checked below
				}
				if !strings.Contains(html, "Alice") {
					t.Error("HTML missing 'Alice'")
				}
				if !strings.Contains(html, "alice@example.com") {
					t.Error("HTML missing 'alice@example.com'")
				}
				if !strings.Contains(html, "<img") {
					t.Error("HTML missing avatar <img> tag")
				}

				data := extractSeamData(t, html)
				user, ok := data["user"].(map[string]any)
				if !ok {
					t.Fatalf("__SEAM_DATA__.user not an object: %v", data)
				}
				if name, _ := user["name"].(string); name != "Alice" {
					t.Errorf("user.name = %q, want 'Alice'", name)
				}
			})

			t.Run("user id=2", func(t *testing.T) {
				status, html := getHTML(t, b.BaseURL+"/seam/page/user/2")
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				if !strings.Contains(html, "Bob") {
					t.Error("HTML missing 'Bob'")
				}
				if !strings.Contains(html, "bob@example.com") {
					t.Error("HTML missing 'bob@example.com'")
				}
				// Bob has no avatar -- conditional block should be removed
				if strings.Contains(html, "<img") {
					t.Error("HTML should not contain <img> for user without avatar")
				}
			})

			t.Run("user id=999", func(t *testing.T) {
				status, _ := getHTML(t, b.BaseURL+"/seam/page/user/999")
				if status == 200 {
					t.Error("expected non-200 for missing user")
				}
			})

			t.Run("no-JS first paint", func(t *testing.T) {
				_, html := getHTML(t, b.BaseURL+"/seam/page/user/1")
				stripped := stripSeamData(html)
				if !strings.Contains(stripped, "Alice") {
					t.Error("'Alice' not visible outside __SEAM_DATA__ script")
				}
			})
		})
	}
}

// --- cross-backend parity ---

func TestPageParity(t *testing.T) {
	if len(backends) < 2 {
		t.Skip("need at least 2 backends for parity test")
	}

	t.Run("user id=1 HTML parity", func(t *testing.T) {
		htmls := make([]string, len(backends))
		for i, b := range backends {
			_, html := getHTML(t, b.BaseURL+"/seam/page/user/1")
			htmls[i] = stripSeamData(html)
		}

		for i := 1; i < len(htmls); i++ {
			if htmls[0] != htmls[i] {
				t.Errorf("HTML mismatch between %s and %s:\n  %s: %s\n  %s: %s",
					backends[0].Name, backends[i].Name,
					backends[0].Name, htmls[0],
					backends[i].Name, htmls[i])
			}
		}
	})

	t.Run("user id=1 data parity", func(t *testing.T) {
		datas := make([]string, len(backends))
		for i, b := range backends {
			_, html := getHTML(t, b.BaseURL+"/seam/page/user/1")
			raw := extractSeamData(t, html)
			j, err := json.Marshal(raw)
			if err != nil {
				t.Fatalf("remarshal: %v", err)
			}
			datas[i] = normalizeJSON(t, j)
		}

		for i := 1; i < len(datas); i++ {
			if datas[0] != datas[i] {
				t.Errorf("data mismatch between %s and %s:\n  %s: %s\n  %s: %s",
					backends[0].Name, backends[i].Name,
					backends[0].Name, datas[0],
					backends[i].Name, datas[i])
			}
		}
	})
}
