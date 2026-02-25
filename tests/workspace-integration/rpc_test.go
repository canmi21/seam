/* tests/workspace-integration/rpc_test.go */

package workspace_integration

import (
	"encoding/json"
	"testing"
)

func TestRPCStaticProcedures(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			rpcURL := b.BaseURL + "/_seam/rpc/"

			t.Run("getSession", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"getSession", map[string]any{})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				username, _ := body["username"].(string)
				theme, _ := body["theme"].(string)
				if username != "visitor" {
					t.Errorf("username = %q, want %q", username, "visitor")
				}
				if theme != "light" {
					t.Errorf("theme = %q, want %q", theme, "light")
				}
			})

			t.Run("getHomeData", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"getHomeData", map[string]any{})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				tagline, _ := body["tagline"].(string)
				if tagline != "Compile-Time Rendering for React" {
					t.Errorf("tagline = %q, want %q", tagline, "Compile-Time Rendering for React")
				}
			})
		})
	}
}

func TestRPCGitHubProcedures(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			rpcURL := b.BaseURL + "/_seam/rpc/"

			t.Run("getUser", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"getUser", map[string]any{"username": "octocat"})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				// Validate required fields exist with correct types
				login, ok := body["login"].(string)
				if !ok || login != "octocat" {
					t.Errorf("login = %v, want %q", body["login"], "octocat")
				}
				if _, ok := body["avatar_url"].(string); !ok {
					t.Errorf("avatar_url missing or not string: %v", body["avatar_url"])
				}
				if _, ok := body["public_repos"].(float64); !ok {
					t.Errorf("public_repos missing or not number: %v", body["public_repos"])
				}
				if _, ok := body["followers"].(float64); !ok {
					t.Errorf("followers missing or not number: %v", body["followers"])
				}
			})

			t.Run("getUserRepos", func(t *testing.T) {
				status, raw := postJSONRaw(t, rpcURL+"getUserRepos", map[string]any{"username": "octocat"})
				if status != 200 {
					t.Fatalf("status = %d, want 200, body: %s", status, raw)
				}
				// Parse as array
				var repos []map[string]any
				if err := parseJSONArray(t, raw, &repos); err != nil {
					t.Fatalf("parse repos: %v", err)
				}
				if len(repos) == 0 {
					t.Fatal("expected at least 1 repo")
				}
				// Validate first repo has required fields
				r := repos[0]
				if _, ok := r["id"].(float64); !ok {
					t.Errorf("repo[0].id missing or not number: %v", r["id"])
				}
				if _, ok := r["name"].(string); !ok {
					t.Errorf("repo[0].name missing or not string: %v", r["name"])
				}
				if _, ok := r["html_url"].(string); !ok {
					t.Errorf("repo[0].html_url missing or not string: %v", r["html_url"])
				}
			})
		})
	}
}

func TestRPCErrors(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			rpcURL := b.BaseURL + "/_seam/rpc/"

			t.Run("unknown procedure", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"nonexistent", map[string]any{})
				if status != 404 {
					t.Errorf("status = %d, want 404", status)
				}
				assertErrorResponse(t, body, "NOT_FOUND")
			})

			t.Run("invalid JSON", func(t *testing.T) {
				status, body := postRaw(t, rpcURL+"getUser", "application/json", "not json{")
				if status != 400 {
					t.Errorf("status = %d, want 400", status)
				}
				assertErrorResponse(t, body, "VALIDATION_ERROR")
			})

			t.Run("wrong type", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"getUser", map[string]any{"username": 42})
				// Go SDK returns 500/INTERNAL_ERROR (no schema-level input validation);
				// TS and Rust SDKs return 400/VALIDATION_ERROR
				if status != 400 && status != 500 {
					t.Errorf("status = %d, want 400 or 500", status)
				}
				errObj, ok := body["error"].(map[string]any)
				if !ok {
					t.Fatalf("expected error envelope, got: %v", body)
				}
				code, _ := errObj["code"].(string)
				if code != "VALIDATION_ERROR" && code != "INTERNAL_ERROR" {
					t.Errorf("error.code = %q, want VALIDATION_ERROR or INTERNAL_ERROR", code)
				}
			})
		})
	}
}

func parseJSONArray(t *testing.T, data []byte, dest *[]map[string]any) error {
	t.Helper()
	return json.Unmarshal(data, dest)
}
