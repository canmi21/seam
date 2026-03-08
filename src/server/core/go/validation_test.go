/* src/server/core/go/validation_test.go */

package seam

import (
	"testing"
)

func TestEmptySchemaAcceptsAnything(t *testing.T) {
	schema := map[string]any{}
	cases := []struct {
		name string
		data any
	}{
		{"null", nil},
		{"string", "hello"},
		{"number", 42.0},
		{"object", map[string]any{"a": 1.0}},
		{"array", []any{1.0, 2.0}},
		{"boolean", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			msg, details := ValidateInput(schema, tc.data)
			if msg != "" {
				t.Errorf("expected valid, got %q with details %v", msg, details)
			}
		})
	}
}

func TestDepthLimit(t *testing.T) {
	// build deeply nested elements schema
	schema := map[string]any{"type": "string"}
	for i := 0; i < 40; i++ {
		schema = map[string]any{"elements": schema}
	}
	// build deeply nested data
	var data any = "leaf"
	for i := 0; i < 40; i++ {
		data = []any{data}
	}
	msg, _ := ValidateInput(schema, data)
	// should not panic; may or may not produce errors depending on depth limit hit
	_ = msg
}

func TestMaxErrorsCap(t *testing.T) {
	schema := map[string]any{"elements": map[string]any{"type": "string"}}
	// 20 invalid items
	items := make([]any, 20)
	for i := range items {
		items[i] = float64(i)
	}
	msg, details := ValidateInput(schema, items)
	if msg == "" {
		t.Fatal("expected error")
	}
	if len(details) > 10 {
		t.Errorf("expected at most 10 errors, got %d", len(details))
	}
}

func TestShouldValidateMode(t *testing.T) {
	t.Run("never", func(t *testing.T) {
		if shouldValidateMode(ValidationModeNever) {
			t.Error("expected false for never")
		}
	})
	t.Run("always", func(t *testing.T) {
		if !shouldValidateMode(ValidationModeAlways) {
			t.Error("expected true for always")
		}
	})
	t.Run("dev_default", func(t *testing.T) {
		t.Setenv("SEAM_ENV", "")
		t.Setenv("NODE_ENV", "")
		if !shouldValidateMode(ValidationModeDev) {
			t.Error("expected true for dev without production env")
		}
	})
	t.Run("dev_seam_production", func(t *testing.T) {
		t.Setenv("SEAM_ENV", "production")
		t.Setenv("NODE_ENV", "")
		if shouldValidateMode(ValidationModeDev) {
			t.Error("expected false for dev with SEAM_ENV=production")
		}
	})
	t.Run("dev_node_production", func(t *testing.T) {
		t.Setenv("SEAM_ENV", "")
		t.Setenv("NODE_ENV", "production")
		if shouldValidateMode(ValidationModeDev) {
			t.Error("expected false for dev with NODE_ENV=production")
		}
	})
}

func TestValidationBuilderMethod(t *testing.T) {
	r := NewRouter()
	r.Validation(ValidationModeAlways)
	if r.validationMode != ValidationModeAlways {
		t.Errorf("expected %q, got %q", ValidationModeAlways, r.validationMode)
	}
}

func TestPathString(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		if s := pathString(nil); s != "" {
			t.Errorf("expected empty, got %q", s)
		}
	})
	t.Run("single", func(t *testing.T) {
		if s := pathString([]string{"foo"}); s != "/foo" {
			t.Errorf("expected /foo, got %q", s)
		}
	})
	t.Run("nested", func(t *testing.T) {
		if s := pathString([]string{"a", "b", "c"}); s != "/a/b/c" {
			t.Errorf("expected /a/b/c, got %q", s)
		}
	})
}

func TestTypeNameOf(t *testing.T) {
	cases := []struct {
		input    any
		expected string
	}{
		{nil, "null"},
		{true, "boolean"},
		{42.0, "number"},
		{"hello", "string"},
		{[]any{}, "array"},
		{map[string]any{}, "object"},
	}
	for _, tc := range cases {
		t.Run(tc.expected, func(t *testing.T) {
			if got := typeNameOf(tc.input); got != tc.expected {
				t.Errorf("expected %q, got %q", tc.expected, got)
			}
		})
	}
}
