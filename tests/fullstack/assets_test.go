/* tests/fullstack/assets_test.go */

package fullstack

import (
	"net/http"
	"regexp"
	"strings"
	"testing"
)

func extractPageScripts(html string) []string {
	re := regexp.MustCompile(`<script[^>]+type="module"[^>]+src="(/_seam/static/[^"]+)"`)
	matches := re.FindAllStringSubmatch(html, -1)
	var urls []string
	for _, m := range matches {
		urls = append(urls, m[1])
	}
	return urls
}

func extractPrefetchLinks(html string) []string {
	re := regexp.MustCompile(`<link[^>]+rel="prefetch"[^>]+href="([^"]+)"`)
	matches := re.FindAllStringSubmatch(html, -1)
	var urls []string
	for _, m := range matches {
		urls = append(urls, m[1])
	}
	return urls
}

func TestPerPageScriptsDiffer(t *testing.T) {
	t.Parallel()
	_, homeHTML := getHTML(t, baseURL+"/_seam/page/")
	_, dashHTML := getHTML(t, baseURL+"/_seam/page/dashboard/octocat")

	homeScripts := extractPageScripts(homeHTML)
	dashScripts := extractPageScripts(dashHTML)

	if len(homeScripts) == 0 {
		t.Skip("no page-specific scripts found in home HTML (page splitting may not be active)")
	}
	if len(dashScripts) == 0 {
		t.Skip("no page-specific scripts found in dashboard HTML")
	}

	homeSet := make(map[string]bool)
	for _, s := range homeScripts {
		homeSet[s] = true
	}
	allSame := true
	for _, s := range dashScripts {
		if !homeSet[s] {
			allSame = false
			break
		}
	}
	if allSame && len(homeScripts) == len(dashScripts) {
		t.Error("home and dashboard pages serve identical script sets; expected per-page differences")
	}
}

func TestPerPagePrefetchPresent(t *testing.T) {
	t.Parallel()
	_, html := getHTML(t, baseURL+"/_seam/page/")

	prefetchLinks := extractPrefetchLinks(html)
	if len(prefetchLinks) == 0 {
		t.Skip("no prefetch links found in home HTML (page splitting may not be active)")
	}

	hasStaticJS := false
	for _, link := range prefetchLinks {
		if strings.HasPrefix(link, "/_seam/static/") && strings.HasSuffix(link, ".js") {
			hasStaticJS = true
			break
		}
	}
	if !hasStaticJS {
		t.Errorf("no prefetch link points to /_seam/static/*.js; got: %v", prefetchLinks)
	}

	for _, marker := range []string{"<!--seam:page-styles-->", "<!--seam:page-scripts-->", "<!--seam:prefetch-->"} {
		if strings.Contains(html, marker) {
			t.Errorf("HTML contains unresolved slot marker: %s", marker)
		}
	}
}

func TestStaticAsset(t *testing.T) {
	t.Parallel()
	_, html := getHTML(t, baseURL+"/_seam/page/")

	assetRe := regexp.MustCompile(`/_seam/static/[^"'\s]+`)
	matches := assetRe.FindAllString(html, -1)
	if len(matches) == 0 {
		t.Skip("no static asset URLs found in page HTML")
	}

	assetURL := baseURL + matches[0]
	resp, err := http.Get(assetURL)
	if err != nil {
		t.Fatalf("GET %s: %v", assetURL, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		t.Errorf("asset status = %d, want 200", resp.StatusCode)
	}

	cc := resp.Header.Get("Cache-Control")
	if !strings.Contains(cc, "immutable") {
		t.Errorf("Cache-Control = %q, want 'immutable'", cc)
	}
}
