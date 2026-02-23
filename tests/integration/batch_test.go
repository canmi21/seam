/* tests/integration/batch_test.go */

package integration

import (
	"testing"
)

func TestBatchRPC(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			batchURL := b.BaseURL + "/_seam/rpc/_batch"

			// Skip backends that don't support batch yet (Rust, Go)
			status, _ := postJSON(t, batchURL, map[string]any{
				"calls": []map[string]any{},
			})
			if status == 404 || status == 405 {
				t.Skip("batch not supported by this backend")
			}

			t.Run("success with two calls", func(t *testing.T) {
				status, body := postJSON(t, batchURL, map[string]any{
					"calls": []map[string]any{
						{"procedure": "greet", "input": map[string]any{"name": "Alice"}},
						{"procedure": "greet", "input": map[string]any{"name": "Bob"}},
					},
				})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				results, ok := body["results"].([]any)
				if !ok {
					t.Fatalf("expected results array, got: %v", body)
				}
				if len(results) != 2 {
					t.Fatalf("results count = %d, want 2", len(results))
				}
				for i, name := range []string{"Alice", "Bob"} {
					item := results[i].(map[string]any)
					if item["ok"] != true {
						t.Errorf("results[%d].ok = %v, want true", i, item["ok"])
					}
					data := item["data"].(map[string]any)
					msg, _ := data["message"].(string)
					expected := "Hello, " + name + "!"
					if msg != expected {
						t.Errorf("results[%d].data.message = %q, want %q", i, msg, expected)
					}
				}
			})

			t.Run("mixed success and failure", func(t *testing.T) {
				status, body := postJSON(t, batchURL, map[string]any{
					"calls": []map[string]any{
						{"procedure": "greet", "input": map[string]any{"name": "Alice"}},
						{"procedure": "nonexistent", "input": map[string]any{}},
					},
				})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				results := body["results"].([]any)
				if len(results) != 2 {
					t.Fatalf("results count = %d, want 2", len(results))
				}
				// First succeeds
				first := results[0].(map[string]any)
				if first["ok"] != true {
					t.Errorf("results[0].ok = %v, want true", first["ok"])
				}
				// Second fails
				second := results[1].(map[string]any)
				if second["ok"] != false {
					t.Errorf("results[1].ok = %v, want false", second["ok"])
				}
				errObj := second["error"].(map[string]any)
				code, _ := errObj["code"].(string)
				if code != "NOT_FOUND" {
					t.Errorf("results[1].error.code = %q, want NOT_FOUND", code)
				}
			})

			t.Run("invalid body returns 400", func(t *testing.T) {
				status, body := postRaw(t, batchURL, "application/json", "not json{")
				if status != 400 {
					t.Errorf("status = %d, want 400", status)
				}
				assertErrorResponse(t, body, "VALIDATION_ERROR")
			})

			t.Run("missing calls field returns 400", func(t *testing.T) {
				status, body := postJSON(t, batchURL, map[string]any{"notCalls": []any{}})
				if status != 400 {
					t.Errorf("status = %d, want 400", status)
				}
				assertErrorResponse(t, body, "VALIDATION_ERROR")
			})

			t.Run("empty calls array returns empty results", func(t *testing.T) {
				status, body := postJSON(t, batchURL, map[string]any{
					"calls": []map[string]any{},
				})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				results := body["results"].([]any)
				if len(results) != 0 {
					t.Errorf("results count = %d, want 0", len(results))
				}
			})
		})
	}
}
