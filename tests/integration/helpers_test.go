/* tests/integration/helpers_test.go */

package integration

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func postJSON(t *testing.T, url string, payload any) (int, map[string]any) {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal response: %v\nbody: %s", err, raw)
	}
	return resp.StatusCode, m
}

func postRaw(t *testing.T, url, contentType string, raw string) (int, map[string]any) {
	t.Helper()
	resp, err := http.Post(url, contentType, strings.NewReader(raw))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal response: %v\nbody: %s", err, data)
	}
	return resp.StatusCode, m
}

func getJSON(t *testing.T, url string) (int, map[string]any) {
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
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal response: %v\nbody: %s", err, raw)
	}
	return resp.StatusCode, m
}

func postJSONRaw(t *testing.T, url string, payload any) (int, []byte) {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp.StatusCode, raw
}

func fetchRaw(t *testing.T, url string) []byte {
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
	return raw
}

// assertOK asserts the response envelope has ok=true and returns the data field.
func assertOK(t *testing.T, body map[string]any) any {
	t.Helper()
	if body["ok"] != true {
		t.Fatalf("expected ok=true, got: %v", body)
	}
	return body["data"]
}

// assertFail asserts the response envelope has ok=false with a well-formed error object.
// Returns the error object for further assertions.
func assertFail(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	if body["ok"] != false {
		t.Fatalf("expected ok=false, got: %v", body)
	}
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("expected error object, got: %v", body["error"])
	}
	if _, ok := errObj["code"].(string); !ok {
		t.Fatalf("expected error.code string, got: %v", errObj["code"])
	}
	if _, ok := errObj["message"].(string); !ok {
		t.Fatalf("expected error.message string, got: %v", errObj["message"])
	}
	if _, ok := errObj["transient"].(bool); !ok {
		t.Fatalf("expected error.transient bool, got: %v (%T)", errObj["transient"], errObj["transient"])
	}
	return errObj
}

func assertErrorResponse(t *testing.T, body map[string]any, expectedCode string) {
	t.Helper()
	errObj := assertFail(t, body)
	code := errObj["code"].(string)
	if code != expectedCode {
		t.Errorf("error.code = %q, want %q", code, expectedCode)
	}
}

func normalizeJSON(t *testing.T, data []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("unmarshal for normalization: %v", err)
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("remarshal for normalization: %v", err)
	}
	return string(out)
}

func assertContentType(t *testing.T, resp *http.Response, prefix string) {
	t.Helper()
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, prefix) {
		t.Errorf("Content-Type = %q, want prefix %q", ct, prefix)
	}
}

func encodeJSON(v any) (*bytes.Reader, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}
