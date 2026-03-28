/* tests/fullstack/page_test.go */

package fullstack

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func extractSeamData(t *testing.T, html string) map[string]any {
	t.Helper()

	match := seamDataRe.FindStringSubmatch(html)
	if len(match) != 2 {
		t.Fatal("HTML missing __data script")
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(match[1]), &data); err != nil {
		t.Fatalf("unmarshal __data JSON: %v", err)
	}

	return data
}

func assertPageHTML(t *testing.T, path string) string {
	t.Helper()
	status, html := getHTML(t, baseURL+path)
	if status != 200 {
		t.Fatalf("GET %s: status = %d, want 200", path, status)
	}

	if !strings.Contains(html, "__seam") {
		t.Errorf("HTML missing __seam")
	}
	if !strings.Contains(html, dataID) {
		t.Errorf("HTML missing %s", dataID)
	}
	if strings.Contains(html, "<!--seam:") {
		idx := strings.Index(html, "<!--seam:")
		end := idx + 60
		if end > len(html) {
			end = len(html)
		}
		t.Errorf("HTML contains unresolved seam marker at byte %d: %s", idx, html[idx:end])
	}

	return html
}

func TestPageHome(t *testing.T) {
	t.Parallel()
	assertPageHTML(t, "/_seam/page/")
}

func TestPageDashboard(t *testing.T) {
	t.Parallel()
	html := assertPageHTML(t, "/_seam/page/dashboard/octocat")
	data := extractSeamData(t, html)

	if !strings.Contains(html, "octocat") {
		t.Error("dashboard HTML missing 'octocat' username")
	}
	if !strings.Contains(html, "Total Stars") {
		t.Error("dashboard HTML missing 'Total Stars' card")
	}

	derived, ok := data["__derived"].(map[string]any)
	if !ok {
		t.Fatalf("__derived not an object: %T", data["__derived"])
	}
	repoStats, ok := derived["repoStats"].(map[string]any)
	if !ok {
		t.Fatalf("__derived.repoStats not an object: %T", derived["repoStats"])
	}
	totalStars, ok := repoStats["totalStars"].(float64)
	if !ok {
		t.Fatalf("__derived.repoStats.totalStars not a number: %T", repoStats["totalStars"])
	}
	if totalStars < 0 {
		t.Errorf("__derived.repoStats.totalStars = %v, want non-negative", totalStars)
	}
	if !strings.Contains(html, fmt.Sprintf(">%.0f<", totalStars)) {
		t.Errorf("dashboard HTML missing rendered totalStars value %.0f", totalStars)
	}
}

func TestRouteManifestIncludesDerives(t *testing.T) {
	t.Parallel()
	root := projectRoot()
	manifestPath := filepath.Join(
		root,
		"examples",
		"github-dashboard",
		"seam-app",
		".seam",
		"output",
		"route-manifest.json",
	)

	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read route-manifest.json: %v", err)
	}

	var manifest struct {
		Routes map[string]struct {
			Derives map[string]any `json:"derives"`
		} `json:"routes"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("unmarshal route-manifest.json: %v", err)
	}

	route, ok := manifest.Routes["/dashboard/:username"]
	if !ok {
		t.Fatal("route-manifest missing /dashboard/:username")
	}
	if len(route.Derives) == 0 {
		t.Fatal("route-manifest missing derives for /dashboard/:username")
	}
	if _, ok := route.Derives["repoStats"]; !ok {
		t.Fatal("route-manifest missing derives.repoStats for /dashboard/:username")
	}
}

var seamDataRe = regexp.MustCompile(`<script id="` + regexp.QuoteMeta(dataID) + `" type="application/json">(.+?)</script>`)
