/* tests/workspace-integration/manifest_test.go */

package workspace_integration

import (
	"net/http"
	"testing"
)

var expectedProcedures = []string{"getSession", "getHomeData", "getUser", "getUserRepos"}

func TestManifest(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			url := b.BaseURL + "/_seam/manifest.json"

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
				version, ok := body["version"].(float64)
				if !ok {
					t.Fatalf("version not a number: %v", body["version"])
				}
				if version != 1 {
					t.Errorf("version = %v, want %v", version, 1)
				}
			})

			t.Run("procedure count", func(t *testing.T) {
				_, body := getJSON(t, url)
				procs, ok := body["procedures"].(map[string]any)
				if !ok {
					t.Fatalf("procedures not an object: %T", body["procedures"])
				}
				if len(procs) != len(expectedProcedures) {
					t.Errorf("procedure count = %d, want %d", len(procs), len(expectedProcedures))
				}
				for _, name := range expectedProcedures {
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
					if _, ok := proc["type"].(string); !ok {
						t.Errorf("procedure %q: missing type field", name)
					}
					if _, ok := proc["input"].(map[string]any); !ok {
						t.Errorf("procedure %q: input not an object", name)
					}
					// getUserRepos has array output, others have object output
					if name == "getUserRepos" {
						if _, ok := proc["output"].(map[string]any); !ok {
							t.Errorf("procedure %q: output not an object", name)
						}
					} else {
						if _, ok := proc["output"].(map[string]any); !ok {
							t.Errorf("procedure %q: output not an object", name)
						}
					}
				}
			})
		})
	}
}
