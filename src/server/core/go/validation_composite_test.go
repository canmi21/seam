/* src/server/core/go/validation_composite_test.go */

package seam

import (
	"testing"
)

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
