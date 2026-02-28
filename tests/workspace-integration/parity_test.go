/* tests/workspace-integration/parity_test.go */

package workspace_integration

import (
	"testing"
)

// TestManifestParity compares procedure names and types across backends.
// All SDKs now place nullable fields in "properties" (with nullable: true)
// and only use "optionalProperties" for truly absent-able fields.
func TestManifestParity(t *testing.T) {
	if len(backends) < 2 {
		t.Skip("need at least 2 backends for parity test")
	}

	type procEntry struct {
		name     string
		procType string
	}

	extractProcs := func(b Backend) []procEntry {
		_, body := getJSON(t, b.BaseURL+"/_seam/manifest.json")
		procs, ok := body["procedures"].(map[string]any)
		if !ok {
			t.Fatalf("%s: procedures not an object", b.Name)
		}
		var result []procEntry
		for name, v := range procs {
			proc := v.(map[string]any)
			pt, _ := proc["type"].(string)
			result = append(result, procEntry{name, pt})
		}
		return result
	}

	refProcs := extractProcs(backends[0])
	for i := 1; i < len(backends); i++ {
		candProcs := extractProcs(backends[i])
		if len(refProcs) != len(candProcs) {
			t.Errorf("procedure count mismatch: %s=%d, %s=%d",
				backends[0].Name, len(refProcs),
				backends[i].Name, len(candProcs))
			continue
		}
		// Build maps for comparison
		refMap := make(map[string]string)
		for _, p := range refProcs {
			refMap[p.name] = p.procType
		}
		for _, p := range candProcs {
			if rt, ok := refMap[p.name]; !ok {
				t.Errorf("%s has procedure %q missing in %s", backends[i].Name, p.name, backends[0].Name)
			} else if rt != p.procType {
				t.Errorf("procedure %q type mismatch: %s=%q, %s=%q",
					p.name, backends[0].Name, rt, backends[i].Name, p.procType)
			}
		}
	}
}

func TestStaticRPCParity(t *testing.T) {
	if len(backends) < 2 {
		t.Skip("need at least 2 backends for parity test")
	}

	// Only hardcoded responses can be compared exactly across backends.
	// getUser/getUserRepos hit live GitHub API, so timing differences
	// may cause slightly different data; tested for structure only.
	cases := []struct {
		name    string
		proc    string
		payload any
	}{
		{"getSession", "getSession", map[string]any{}},
		{"getHomeData", "getHomeData", map[string]any{}},
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

func TestGitHubRPCParity(t *testing.T) {
	if len(backends) < 2 {
		t.Skip("need at least 2 backends for parity test")
	}

	// All backends call the same GitHub API, so for the same user
	// they should return identical results (same fields, same values).
	cases := []struct {
		name    string
		proc    string
		payload any
	}{
		{"getUser octocat", "getUser", map[string]any{"username": "octocat"}},
		{"getUserRepos octocat", "getUserRepos", map[string]any{"username": "octocat"}},
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

	// Only test error codes that are consistent across all SDK implementations.
	// "wrong type" is excluded: Go SDK returns INTERNAL_ERROR (no schema validation),
	// while TS/Rust return VALIDATION_ERROR.
	cases := []struct {
		name    string
		proc    string
		payload any
	}{
		{"unknown procedure", "nonexistent", map[string]any{}},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			codes := make([]string, len(backends))

			for i, b := range backends {
				_, body := postJSON(t, b.BaseURL+"/_seam/procedure/"+tc.proc, tc.payload)
				errObj, ok := body["error"].(map[string]any)
				if !ok {
					t.Fatalf("%s: no error envelope", backends[i].Name)
				}
				code, _ := errObj["code"].(string)
				codes[i] = code
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
