/* tests/integration/manifest_test.go */

package integration

import (
	"net/http"
	"testing"
)

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
					t.Fatalf("version not a number: %v (%T)", body["version"], body["version"])
				}
				if version != 1 {
					t.Errorf("version = %v, want 1", version)
				}
			})

			t.Run("common procedures exist", func(t *testing.T) {
				_, body := getJSON(t, url)
				procs, ok := body["procedures"].(map[string]any)
				if !ok {
					t.Fatalf("procedures not an object: %T", body["procedures"])
				}
				// All backends must have these 4 procedures
				required := []string{"greet", "getUser", "listUsers", "onCount"}
				for _, name := range required {
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

func TestManifestProcedureTypes(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			url := b.BaseURL + "/_seam/manifest.json"
			_, body := getJSON(t, url)
			procs, ok := body["procedures"].(map[string]any)
			if !ok {
				t.Fatalf("procedures not an object")
			}

			validTypes := map[string]bool{"query": true, "command": true, "subscription": true}

			// Every procedure must have a valid type
			for name, v := range procs {
				proc := v.(map[string]any)
				pType, ok := proc["type"].(string)
				if !ok {
					t.Errorf("procedure %q: type not a string: %v", name, proc["type"])
					continue
				}
				if !validTypes[pType] {
					t.Errorf("procedure %q: type = %q, want one of query/command/subscription", name, pType)
				}
			}

			// Assert specific known types
			assertProcType := func(name, expected string) {
				proc, ok := procs[name].(map[string]any)
				if !ok {
					t.Errorf("procedure %q not found", name)
					return
				}
				got, _ := proc["type"].(string)
				if got != expected {
					t.Errorf("%s.type = %q, want %q", name, got, expected)
				}
			}

			assertProcType("greet", "query")
			assertProcType("onCount", "subscription")

			// If updateEmail exists (Bun backend), assert it's a command
			if _, exists := procs["updateEmail"]; exists {
				assertProcType("updateEmail", "command")
			}
		})
	}
}
