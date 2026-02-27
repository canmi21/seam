/* tests/i18n/i18n_test.go */

package i18n

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// Two servers: one for prefix mode, one for hidden mode
var prefixBaseURL string
var hiddenBaseURL string

var seamDataRe = regexp.MustCompile(`<script id="__SEAM_DATA__" type="application/json">(.+?)</script>`)
var langAttrRe = regexp.MustCompile(`<html[^>]*\slang="([^"]+)"`)

func projectRoot() string {
	abs, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		panic(err)
	}
	return abs
}

func freePort() int {
	ln, err := net.Listen("tcp", ":0")
	if err != nil {
		panic(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	return port
}

func startServer(mode string, port int, buildDir string) (*exec.Cmd, error) {
	root := projectRoot()
	binary := filepath.Join(root, "target", "release", "i18n-demo-axum")

	cmd := exec.Command(binary)
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("PORT=%d", port),
		fmt.Sprintf("SEAM_OUTPUT_DIR=%s", buildDir),
		fmt.Sprintf("I18N_MODE=%s", mode),
	)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

func waitReady(baseURL string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		// Prefix mode registers pages under locale prefixes, hidden under bare paths.
		// Use /_seam/page/ directly — both modes register this internal route.
		resp, err := http.Get(baseURL + "/_seam/page/")
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			return true
		}
		if resp != nil {
			resp.Body.Close()
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}

func TestMain(m *testing.M) {
	root := projectRoot()
	buildDir := filepath.Join(root, "examples", "i18n-demo", "seam-app", ".seam", "output")

	// Verify build output exists
	if _, err := os.Stat(filepath.Join(buildDir, "route-manifest.json")); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "build output not found: run 'seam build' in examples/i18n-demo/seam-app first")
		os.Exit(1)
	}

	// Verify binary exists
	binary := filepath.Join(root, "target", "release", "i18n-demo-axum")
	if _, err := os.Stat(binary); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "binary not found: run 'cargo build -p i18n-demo-axum --release' first")
		os.Exit(1)
	}

	// Start prefix mode server
	prefixPort := freePort()
	prefixCmd, err := startServer("prefix", prefixPort, buildDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to start prefix server: %v\n", err)
		os.Exit(1)
	}
	prefixBaseURL = fmt.Sprintf("http://localhost:%d", prefixPort)

	// Start hidden mode server
	hiddenPort := freePort()
	hiddenCmd, err := startServer("hidden", hiddenPort, buildDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to start hidden server: %v\n", err)
		prefixCmd.Process.Kill()
		prefixCmd.Wait()
		os.Exit(1)
	}
	hiddenBaseURL = fmt.Sprintf("http://localhost:%d", hiddenPort)

	// Wait for both servers
	if !waitReady(prefixBaseURL, 15*time.Second) {
		fmt.Fprintln(os.Stderr, "prefix server did not become ready within 15s")
		prefixCmd.Process.Kill()
		hiddenCmd.Process.Kill()
		prefixCmd.Wait()
		hiddenCmd.Wait()
		os.Exit(1)
	}
	if !waitReady(hiddenBaseURL, 15*time.Second) {
		fmt.Fprintln(os.Stderr, "hidden server did not become ready within 15s")
		prefixCmd.Process.Kill()
		hiddenCmd.Process.Kill()
		prefixCmd.Wait()
		hiddenCmd.Wait()
		os.Exit(1)
	}

	code := m.Run()

	prefixCmd.Process.Kill()
	hiddenCmd.Process.Kill()
	prefixCmd.Wait()
	hiddenCmd.Wait()
	os.Exit(code)
}

// -- Helpers --

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

func getHTMLWithHeaders(t *testing.T, url string, headers map[string]string) (int, string) {
	t.Helper()
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{
		// Do not follow redirects automatically
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Do(req)
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

func extractLang(t *testing.T, html string) string {
	t.Helper()
	m := langAttrRe.FindStringSubmatch(html)
	if len(m) < 2 {
		t.Fatal("html tag missing lang attribute")
	}
	return m[1]
}

func extractSeamData(t *testing.T, html string) map[string]any {
	t.Helper()
	m := seamDataRe.FindStringSubmatch(html)
	if len(m) < 2 {
		t.Fatal("__SEAM_DATA__ script not found")
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(m[1]), &data); err != nil {
		t.Fatalf("unmarshal __SEAM_DATA__: %v", err)
	}
	return data
}

func extractI18nLocale(t *testing.T, html string) string {
	t.Helper()
	data := extractSeamData(t, html)
	i18n, ok := data["_i18n"].(map[string]any)
	if !ok {
		t.Fatal("_i18n not found or not an object in __SEAM_DATA__")
	}
	locale, ok := i18n["locale"].(string)
	if !ok {
		t.Fatal("_i18n.locale not found or not a string")
	}
	return locale
}

// -- Prefix mode tests --

func TestPrefixDefaultEnglish(t *testing.T) {
	status, html := getHTML(t, prefixBaseURL+"/_seam/page/")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "en" {
		t.Errorf("lang = %q, want %q", lang, "en")
	}

	locale := extractI18nLocale(t, html)
	if locale != "en" {
		t.Errorf("_i18n.locale = %q, want %q", locale, "en")
	}

	if strings.Contains(html, "<!--seam:") {
		t.Error("HTML contains unresolved seam markers")
	}
}

func TestPrefixChineseRoot(t *testing.T) {
	status, html := getHTML(t, prefixBaseURL+"/_seam/page/zh/")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "zh" {
		t.Errorf("lang = %q, want %q", lang, "zh")
	}

	locale := extractI18nLocale(t, html)
	if locale != "zh" {
		t.Errorf("_i18n.locale = %q, want %q", locale, "zh")
	}
}

func TestPrefixChineseAbout(t *testing.T) {
	status, html := getHTML(t, prefixBaseURL+"/_seam/page/zh/about")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "zh" {
		t.Errorf("lang = %q, want %q", lang, "zh")
	}

	locale := extractI18nLocale(t, html)
	if locale != "zh" {
		t.Errorf("_i18n.locale = %q, want %q", locale, "zh")
	}
}

func TestPrefixEnglishAbout(t *testing.T) {
	status, html := getHTML(t, prefixBaseURL+"/_seam/page/about")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "en" {
		t.Errorf("lang = %q, want %q", lang, "en")
	}
}

// -- Hidden mode tests --

func TestHiddenDefaultEnglish(t *testing.T) {
	status, html := getHTML(t, hiddenBaseURL+"/_seam/page/")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "en" {
		t.Errorf("lang = %q, want %q", lang, "en")
	}

	locale := extractI18nLocale(t, html)
	if locale != "en" {
		t.Errorf("_i18n.locale = %q, want %q", locale, "en")
	}
}

func TestHiddenQueryParam(t *testing.T) {
	status, html := getHTML(t, hiddenBaseURL+"/_seam/page/?lang=zh")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "zh" {
		t.Errorf("lang = %q, want %q", lang, "zh")
	}

	locale := extractI18nLocale(t, html)
	if locale != "zh" {
		t.Errorf("_i18n.locale = %q, want %q", locale, "zh")
	}
}

func TestHiddenCookie(t *testing.T) {
	status, html := getHTMLWithHeaders(t, hiddenBaseURL+"/_seam/page/", map[string]string{
		"Cookie": "seam-locale=zh",
	})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "zh" {
		t.Errorf("lang = %q, want %q", lang, "zh")
	}
}

func TestHiddenAcceptLanguage(t *testing.T) {
	status, html := getHTMLWithHeaders(t, hiddenBaseURL+"/_seam/page/", map[string]string{
		"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
	})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "zh" {
		t.Errorf("lang = %q, want %q", lang, "zh")
	}
}

func TestHiddenQueryBeatsCoookie(t *testing.T) {
	// Query param should take priority over cookie
	status, html := getHTMLWithHeaders(t, hiddenBaseURL+"/_seam/page/?lang=en", map[string]string{
		"Cookie": "seam-locale=zh",
	})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "en" {
		t.Errorf("lang = %q, want %q (query should beat cookie)", lang, "en")
	}
}

func TestHiddenCookieBbeatsAcceptLanguage(t *testing.T) {
	// Cookie should take priority over Accept-Language
	status, html := getHTMLWithHeaders(t, hiddenBaseURL+"/_seam/page/", map[string]string{
		"Cookie":          "seam-locale=zh",
		"Accept-Language": "en-US,en;q=0.9",
	})
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "zh" {
		t.Errorf("lang = %q, want %q (cookie should beat accept-language)", lang, "zh")
	}
}

func TestHiddenAboutPage(t *testing.T) {
	status, html := getHTML(t, hiddenBaseURL+"/_seam/page/about?lang=zh")
	if status != 200 {
		t.Fatalf("status = %d, want 200", status)
	}

	lang := extractLang(t, html)
	if lang != "zh" {
		t.Errorf("lang = %q, want %q", lang, "zh")
	}
}
