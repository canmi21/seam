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

func TestStringType(t *testing.T) {
	schema := map[string]any{"type": "string"}
	t.Run("valid", func(t *testing.T) {
		msg, _ := ValidateInput(schema, "hello")
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("invalid_number", func(t *testing.T) {
		msg, details := ValidateInput(schema, 42.0)
		if msg == "" {
			t.Fatal("expected error")
		}
		if len(details) != 1 || details[0].Expected != "string" {
			t.Errorf("unexpected details: %v", details)
		}
	})
	t.Run("invalid_null", func(t *testing.T) {
		msg, _ := ValidateInput(schema, nil)
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestBooleanType(t *testing.T) {
	schema := map[string]any{"type": "boolean"}
	t.Run("valid", func(t *testing.T) {
		msg, _ := ValidateInput(schema, true)
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("invalid", func(t *testing.T) {
		msg, _ := ValidateInput(schema, "true")
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestInt32Range(t *testing.T) {
	schema := map[string]any{"type": "int32"}
	t.Run("valid_42", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 42.0)
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("reject_overflow", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 2147483648.0)
		if msg == "" {
			t.Fatal("expected error for overflow")
		}
	})
	t.Run("reject_float", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 1.5)
		if msg == "" {
			t.Fatal("expected error for non-integer")
		}
	})
	t.Run("reject_string", func(t *testing.T) {
		msg, _ := ValidateInput(schema, "hello")
		if msg == "" {
			t.Fatal("expected error for string")
		}
	})
}

func TestUint8Range(t *testing.T) {
	schema := map[string]any{"type": "uint8"}
	t.Run("valid_0", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 0.0)
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("valid_255", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 255.0)
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("reject_256", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 256.0)
		if msg == "" {
			t.Fatal("expected error")
		}
	})
	t.Run("reject_negative", func(t *testing.T) {
		msg, _ := ValidateInput(schema, -1.0)
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestInt8Range(t *testing.T) {
	schema := map[string]any{"type": "int8"}
	t.Run("valid_neg128", func(t *testing.T) {
		msg, _ := ValidateInput(schema, -128.0)
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("valid_127", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 127.0)
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("reject_128", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 128.0)
		if msg == "" {
			t.Fatal("expected error")
		}
	})
	t.Run("reject_neg129", func(t *testing.T) {
		msg, _ := ValidateInput(schema, -129.0)
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestFloat64AcceptsAnyNumber(t *testing.T) {
	schema := map[string]any{"type": "float64"}
	t.Run("integer", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 42.0)
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("decimal", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 3.14)
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("reject_string", func(t *testing.T) {
		msg, _ := ValidateInput(schema, "42")
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestTimestamp(t *testing.T) {
	schema := map[string]any{"type": "timestamp"}
	t.Run("valid_utc", func(t *testing.T) {
		msg, _ := ValidateInput(schema, "2024-01-15T10:30:00Z")
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("reject_invalid", func(t *testing.T) {
		msg, _ := ValidateInput(schema, "not-a-date")
		if msg == "" {
			t.Fatal("expected error")
		}
	})
	t.Run("reject_number", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 1234567890.0)
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestEnum(t *testing.T) {
	schema := map[string]any{"enum": []any{"red", "green", "blue"}}
	t.Run("valid", func(t *testing.T) {
		msg, _ := ValidateInput(schema, "red")
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("reject_invalid", func(t *testing.T) {
		msg, details := ValidateInput(schema, "yellow")
		if msg == "" {
			t.Fatal("expected error")
		}
		if len(details) != 1 {
			t.Fatalf("expected 1 detail, got %d", len(details))
		}
	})
	t.Run("reject_number", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 42.0)
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestElements(t *testing.T) {
	schema := map[string]any{"elements": map[string]any{"type": "string"}}
	t.Run("valid", func(t *testing.T) {
		msg, _ := ValidateInput(schema, []any{"a", "b", "c"})
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("invalid_item", func(t *testing.T) {
		msg, details := ValidateInput(schema, []any{"a", 42.0, "c"})
		if msg == "" {
			t.Fatal("expected error")
		}
		if len(details) != 1 || details[0].Path != "/1" {
			t.Errorf("unexpected details: %v", details)
		}
	})
	t.Run("reject_non_array", func(t *testing.T) {
		msg, _ := ValidateInput(schema, "not an array")
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestValues(t *testing.T) {
	schema := map[string]any{"values": map[string]any{"type": "float64"}}
	t.Run("valid", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"x": 1.0, "y": 2.0})
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("invalid_value", func(t *testing.T) {
		msg, details := ValidateInput(schema, map[string]any{"x": 1.0, "y": "oops"})
		if msg == "" {
			t.Fatal("expected error")
		}
		if len(details) != 1 {
			t.Fatalf("expected 1 detail, got %d", len(details))
		}
		if details[0].Path != "/y" {
			t.Errorf("expected path /y, got %q", details[0].Path)
		}
	})
	t.Run("reject_non_object", func(t *testing.T) {
		msg, _ := ValidateInput(schema, []any{1.0})
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestPropertiesRequired(t *testing.T) {
	schema := map[string]any{
		"properties": map[string]any{
			"name": map[string]any{"type": "string"},
			"age":  map[string]any{"type": "int32"},
		},
	}
	t.Run("valid", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"name": "Alice", "age": 30.0})
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("missing_required", func(t *testing.T) {
		msg, details := ValidateInput(schema, map[string]any{"name": "Alice"})
		if msg == "" {
			t.Fatal("expected error")
		}
		found := false
		for _, d := range details {
			if d.Path == "/age" && d.Actual == "missing" {
				found = true
			}
		}
		if !found {
			t.Errorf("expected missing age detail, got %v", details)
		}
	})
}

func TestPropertiesOptional(t *testing.T) {
	schema := map[string]any{
		"properties": map[string]any{
			"name": map[string]any{"type": "string"},
		},
		"optionalProperties": map[string]any{
			"email": map[string]any{"type": "string"},
		},
	}
	t.Run("without_optional", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"name": "Alice"})
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("with_optional", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"name": "Alice", "email": "alice@example.com"})
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("invalid_optional", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"name": "Alice", "email": 42.0})
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestPropertiesAdditional(t *testing.T) {
	schema := map[string]any{
		"properties": map[string]any{
			"name": map[string]any{"type": "string"},
		},
		"additionalProperties": true,
	}
	t.Run("allow_extra", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"name": "Alice", "extra": "ok"})
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
}

func TestExtraPropertiesRejected(t *testing.T) {
	schema := map[string]any{
		"properties": map[string]any{
			"name": map[string]any{"type": "string"},
		},
	}
	msg, details := ValidateInput(schema, map[string]any{"name": "Alice", "extra": "bad"})
	if msg == "" {
		t.Fatal("expected error")
	}
	found := false
	for _, d := range details {
		if d.Path == "/extra" && d.Actual == "unexpected property" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected extra property detail, got %v", details)
	}
}

func TestDiscriminator(t *testing.T) {
	schema := map[string]any{
		"discriminator": "type",
		"mapping": map[string]any{
			"circle": map[string]any{
				"properties": map[string]any{
					"radius": map[string]any{"type": "float64"},
				},
			},
			"square": map[string]any{
				"properties": map[string]any{
					"side": map[string]any{"type": "float64"},
				},
			},
		},
	}
	t.Run("valid_circle", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"type": "circle", "radius": 5.0})
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("valid_square", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"type": "square", "side": 4.0})
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("wrong_branch_field", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"type": "circle", "side": 4.0})
		if msg == "" {
			t.Fatal("expected error")
		}
	})
	t.Run("unknown_tag", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{"type": "triangle"})
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestDiscriminatorMissingTag(t *testing.T) {
	schema := map[string]any{
		"discriminator": "kind",
		"mapping": map[string]any{
			"a": map[string]any{},
		},
	}
	msg, details := ValidateInput(schema, map[string]any{"other": "value"})
	if msg == "" {
		t.Fatal("expected error")
	}
	if len(details) == 0 || details[0].Actual != "missing" {
		t.Errorf("expected missing tag detail, got %v", details)
	}
}

func TestNullable(t *testing.T) {
	schema := map[string]any{"type": "string", "nullable": true}
	t.Run("null_accepted", func(t *testing.T) {
		msg, _ := ValidateInput(schema, nil)
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("valid_string", func(t *testing.T) {
		msg, _ := ValidateInput(schema, "hello")
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("invalid_number", func(t *testing.T) {
		msg, _ := ValidateInput(schema, 42.0)
		if msg == "" {
			t.Fatal("expected error")
		}
	})
}

func TestRefDefinitions(t *testing.T) {
	schema := map[string]any{
		"definitions": map[string]any{
			"address": map[string]any{
				"properties": map[string]any{
					"street": map[string]any{"type": "string"},
					"city":   map[string]any{"type": "string"},
				},
			},
		},
		"properties": map[string]any{
			"home": map[string]any{"ref": "address"},
		},
	}
	t.Run("valid", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{
			"home": map[string]any{"street": "123 Main St", "city": "Springfield"},
		})
		if msg != "" {
			t.Errorf("expected valid, got %q", msg)
		}
	})
	t.Run("invalid_ref", func(t *testing.T) {
		msg, _ := ValidateInput(schema, map[string]any{
			"home": map[string]any{"street": 42.0},
		})
		if msg == "" {
			t.Fatal("expected error")
		}
	})
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
