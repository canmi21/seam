package integration

import (
	"net/http"
	"testing"
)

func TestRPCSuccess(t *testing.T) {
	for _, b := range backends {
		b := b
		t.Run(b.Name, func(t *testing.T) {
			rpcURL := b.BaseURL + "/seam/rpc/"

			t.Run("greet", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"greet", map[string]any{"name": "Alice"})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				msg, _ := body["message"].(string)
				if msg != "Hello, Alice!" {
					t.Errorf("message = %q, want %q", msg, "Hello, Alice!")
				}
			})

			t.Run("getUser", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"getUser", map[string]any{"id": 1})
				if status != 200 {
					t.Fatalf("status = %d, want 200", status)
				}
				id, _ := body["id"].(float64)
				name, _ := body["name"].(string)
				email, _ := body["email"].(string)
				avatar, _ := body["avatar"].(string)
				if int(id) != 1 {
					t.Errorf("id = %v, want 1", body["id"])
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
				_, raw := postJSONRaw(t, rpcURL+"listUsers", map[string]any{})
				// Response is an array, parse directly
				var users []map[string]any
				if err := parseJSONArray(t, raw, &users); err != nil {
					t.Fatalf("parse array: %v", err)
				}
				if len(users) != 3 {
					t.Fatalf("user count = %d, want 3", len(users))
				}
				names := []string{"Alice", "Bob", "Charlie"}
				for i, name := range names {
					got, _ := users[i]["name"].(string)
					if got != name {
						t.Errorf("users[%d].name = %q, want %q", i, got, name)
					}
				}
			})

			t.Run("content type", func(t *testing.T) {
				resp := postJSONResp(t, rpcURL+"greet", map[string]any{"name": "Test"})
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
			rpcURL := b.BaseURL + "/seam/rpc/"

			t.Run("unknown procedure", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"nonexistent", map[string]any{})
				if status != 404 {
					t.Errorf("status = %d, want 404", status)
				}
				assertErrorResponse(t, body, "NOT_FOUND")
			})

			t.Run("invalid JSON", func(t *testing.T) {
				status, body := postRaw(t, rpcURL+"greet", "application/json", "not json{")
				if status != 400 {
					t.Errorf("status = %d, want 400", status)
				}
				assertErrorResponse(t, body, "VALIDATION_ERROR")
			})

			t.Run("wrong type", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"greet", map[string]any{"name": 42})
				if status != 400 {
					t.Errorf("status = %d, want 400", status)
				}
				assertErrorResponse(t, body, "VALIDATION_ERROR")
			})

			t.Run("handler not found", func(t *testing.T) {
				status, body := postJSON(t, rpcURL+"getUser", map[string]any{"id": 999})
				if status != 404 {
					t.Errorf("status = %d, want 404", status)
				}
				assertErrorResponse(t, body, "NOT_FOUND")
			})

			t.Run("wrong HTTP method", func(t *testing.T) {
				resp, err := http.Get(rpcURL + "greet")
				if err != nil {
					t.Fatalf("GET %s: %v", rpcURL+"greet", err)
				}
				resp.Body.Close()
				// TS returns 404 (catch-all), Rust/Axum returns 405 (method not allowed)
				if resp.StatusCode != 404 && resp.StatusCode != 405 {
					t.Errorf("status = %d, want 404 or 405", resp.StatusCode)
				}
			})
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
