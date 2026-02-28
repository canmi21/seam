/* tests/integration/rpc_test.go */

package integration

import (
	"net/http"
	"testing"
)

func TestRPCSuccess(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			procURL := b.BaseURL + "/_seam/procedure/"

			t.Run("greet", func(t *testing.T) {
				status, body := postJSON(t, procURL+"greet", map[string]any{"name": "Alice"})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				data := assertOK(t, body)
				dataMap := data.(map[string]any)
				msg, _ := dataMap["message"].(string)
				if msg != "Hello, Alice!" {
					t.Errorf("message = %q, want %q", msg, "Hello, Alice!")
				}
			})

			t.Run("getUser", func(t *testing.T) {
				status, body := postJSON(t, procURL+"getUser", map[string]any{"id": 1})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				data := assertOK(t, body)
				dataMap := data.(map[string]any)
				id, _ := dataMap["id"].(float64)
				name, _ := dataMap["name"].(string)
				email, _ := dataMap["email"].(string)
				avatar, _ := dataMap["avatar"].(string)
				if int(id) != 1 {
					t.Errorf("id = %v, want 1", dataMap["id"])
				}
				if name != "Alice" {
					t.Errorf("name = %q, want %q", name, "Alice")
				}
				if email != "alice@example.com" {
					t.Errorf("email = %q, want %q", email, "alice@example.com")
				}
				if avatar != "https://example.com/alice.png" {
					t.Errorf("avatar = %q, want %q", avatar, "https://example.com/alice.png")
				}
			})

			t.Run("listUsers", func(t *testing.T) {
				status, body := postJSON(t, procURL+"listUsers", map[string]any{})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				data := assertOK(t, body)
				users, ok := data.([]any)
				if !ok {
					t.Fatalf("expected data to be array, got: %T", data)
				}
				if len(users) != 3 {
					t.Fatalf("user count = %d, want 3", len(users))
				}
				names := []string{"Alice", "Bob", "Charlie"}
				for i, name := range names {
					u := users[i].(map[string]any)
					got, _ := u["name"].(string)
					if got != name {
						t.Errorf("users[%d].name = %q, want %q", i, got, name)
					}
				}
			})

			t.Run("content type", func(t *testing.T) {
				resp := postJSONResp(t, procURL+"greet", map[string]any{"name": "Test"})
				defer resp.Body.Close()
				assertContentType(t, resp, "application/json")
			})
		})
	}
}

func TestRPCErrors(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			procURL := b.BaseURL + "/_seam/procedure/"

			t.Run("unknown procedure", func(t *testing.T) {
				status, body := postJSON(t, procURL+"nonexistent", map[string]any{})
				if status != 404 {
					t.Errorf("status = %d, want 404", status)
				}
				assertErrorResponse(t, body, "NOT_FOUND")
			})

			t.Run("invalid JSON", func(t *testing.T) {
				status, body := postRaw(t, procURL+"greet", "application/json", "not json{")
				if status != 400 {
					t.Errorf("status = %d, want 400", status)
				}
				assertErrorResponse(t, body, "VALIDATION_ERROR")
			})

			t.Run("wrong type", func(t *testing.T) {
				status, body := postJSON(t, procURL+"greet", map[string]any{"name": 42})
				if status != 400 {
					t.Errorf("status = %d, want 400", status)
				}
				assertErrorResponse(t, body, "VALIDATION_ERROR")
			})

			t.Run("handler not found", func(t *testing.T) {
				status, body := postJSON(t, procURL+"getUser", map[string]any{"id": 999})
				if status != 404 {
					t.Errorf("status = %d, want 404", status)
				}
				assertErrorResponse(t, body, "NOT_FOUND")
			})

			// No "wrong HTTP method" test: new protocol uses GET for subscriptions
			// on the same /_seam/procedure/ path. GET on a non-subscription procedure
			// is covered by subscribe_test.go "unknown subscription returns error event".
		})
	}
}

func TestCommandProcedure(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			procURL := b.BaseURL + "/_seam/procedure/updateEmail"
			status, body := postJSON(t, procURL, map[string]any{
				"userId":   1,
				"newEmail": "new@example.com",
			})
			// Skip backends that don't have updateEmail (non-Bun)
			if status == 404 {
				t.Skip("updateEmail not available on this backend")
			}
			if status != 200 {
				t.Fatalf("status = %d, want 200", status)
			}
			data := assertOK(t, body)
			dataMap, ok := data.(map[string]any)
			if !ok {
				t.Fatalf("expected data to be object, got: %T", data)
			}
			if dataMap["success"] != true {
				t.Errorf("data.success = %v, want true", dataMap["success"])
			}
		})
	}
}

// postJSONResp returns the raw http.Response for header inspection
func postJSONResp(t *testing.T, url string, payload any) *http.Response {
	t.Helper()
	body, err := encodeJSON(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	resp, err := http.Post(url, "application/json", body)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	return resp
}
