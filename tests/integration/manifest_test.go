package integration

import (
	"net/http"
	"testing"
)

func TestManifest(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			url := b.BaseURL + "/seam/manifest.json"

			t.Run("status and content type", func(t *testing.T) {
				resp, err := http.Get(url)
				if err != nil {
					t.Fatalf("GET %s: %v", url, err)
				}
				defer resp.Body.Close()
				if resp.StatusCode != 200 {
					t.Errorf("status = %d, want 200", resp.StatusCode)
				}
				assertContentType(t, resp, "application/json")
			})

			t.Run("version", func(t *testing.T) {
				_, body := getJSON(t, url)
				version, ok := body["version"].(string)
				if !ok {
					t.Fatalf("version not a string: %v", body["version"])
				}
				if version != "0.1.0" {
					t.Errorf("version = %q, want %q", version, "0.1.0")
				}
			})

			t.Run("procedure count", func(t *testing.T) {
				_, body := getJSON(t, url)
				procs, ok := body["procedures"].(map[string]any)
				if !ok {
					t.Fatalf("procedures not an object: %T", body["procedures"])
				}
				expected := []string{"greet", "getUser", "listUsers"}
				if len(procs) != len(expected) {
					t.Errorf("procedure count = %d, want %d", len(procs), len(expected))
				}
				for _, name := range expected {
					if _, exists := procs[name]; !exists {
						t.Errorf("missing procedure %q", name)
					}
				}
			})

			t.Run("procedure schemas", func(t *testing.T) {
				_, body := getJSON(t, url)
				procs := body["procedures"].(map[string]any)
				for name, v := range procs {
					proc, ok := v.(map[string]any)
					if !ok {
						t.Errorf("procedure %q not an object", name)
						continue
					}
					if _, ok := proc["input"].(map[string]any); !ok {
						t.Errorf("procedure %q: input not an object", name)
					}
					if _, ok := proc["output"].(map[string]any); !ok {
						t.Errorf("procedure %q: output not an object", name)
					}
				}
			})
		})
	}
}
