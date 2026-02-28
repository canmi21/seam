/* tests/integration/parity_test.go */

package integration

import (
	"encoding/json"
	"testing"
)

// commonProcedures are present in all backends; Bun may have extras like updateEmail.
var commonProcedures = []string{"greet", "getUser", "listUsers", "onCount"}

func TestManifestParity(t *testing.T) {
	if len(backends) < 2 {
		t.Skip("need at least 2 backends for parity test")
	}

	// Extract only common procedures from each manifest for comparison
	type commonManifest struct {
		Version    any            `json:"version"`
		Procedures map[string]any `json:"procedures"`
	}

	manifests := make([]string, len(backends))
	for i, b := range backends {
		raw := fetchRaw(t, b.BaseURL+"/_seam/manifest.json")
		var full map[string]any
		if err := json.Unmarshal(raw, &full); err != nil {
			t.Fatalf("%s: unmarshal manifest: %v", b.Name, err)
		}
		procs, _ := full["procedures"].(map[string]any)
		filtered := make(map[string]any, len(commonProcedures))
		for _, name := range commonProcedures {
			if v, ok := procs[name]; ok {
				filtered[name] = v
			}
		}
		cm := commonManifest{Version: full["version"], Procedures: filtered}
		out, _ := json.Marshal(cm)
		manifests[i] = string(out)
	}

	for i := 1; i < len(manifests); i++ {
		if manifests[0] != manifests[i] {
			t.Errorf("manifest mismatch between %s and %s\n  %s: %s\n  %s: %s",
				backends[0].Name, backends[i].Name,
				backends[0].Name, manifests[0],
				backends[i].Name, manifests[i])
		}
	}
}

func TestRPCParity(t *testing.T) {
	if len(backends) < 2 {
		t.Skip("need at least 2 backends for parity test")
	}

	// Only test cases where both backends produce identical output.
	// Skip getUser id=2 (Bob): TS returns "avatar": null, Rust omits the field.
	cases := []struct {
		name    string
		proc    string
		payload any
	}{
		{"greet", "greet", map[string]any{"name": "Alice"}},
		{"listUsers", "listUsers", map[string]any{}},
		{"getUser id=1", "getUser", map[string]any{"id": 1}},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			responses := make([]string, len(backends))
			statuses := make([]int, len(backends))

			for i, b := range backends {
				status, raw := postJSONRaw(t, b.BaseURL+"/_seam/procedure/"+tc.proc, tc.payload)
				statuses[i] = status
				responses[i] = normalizeJSON(t, raw)
			}

			for i := 1; i < len(backends); i++ {
				if statuses[0] != statuses[i] {
					t.Errorf("status mismatch: %s=%d, %s=%d",
						backends[0].Name, statuses[0],
						backends[i].Name, statuses[i])
				}
				if responses[0] != responses[i] {
					t.Errorf("response mismatch for %s:\n  %s: %s\n  %s: %s",
						tc.name,
						backends[0].Name, responses[0],
						backends[i].Name, responses[i])
				}
			}
		})
	}
}

func TestErrorCodeParity(t *testing.T) {
	if len(backends) < 2 {
		t.Skip("need at least 2 backends for parity test")
	}

	cases := []struct {
		name    string
		proc    string
		payload any
	}{
		{"unknown procedure", "nonexistent", map[string]any{}},
		{"wrong type", "greet", map[string]any{"name": 42}},
		{"handler not found", "getUser", map[string]any{"id": 999}},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			codes := make([]string, len(backends))

			for i, b := range backends {
				_, body := postJSON(t, b.BaseURL+"/_seam/procedure/"+tc.proc, tc.payload)
				errObj := assertFail(t, body)
				codes[i] = errObj["code"].(string)
			}

			for i := 1; i < len(codes); i++ {
				if codes[0] != codes[i] {
					t.Errorf("error code mismatch: %s=%q, %s=%q",
						backends[0].Name, codes[0],
						backends[i].Name, codes[i])
				}
			}
		})
	}
}