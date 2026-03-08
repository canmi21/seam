/* src/server/core/go/validation_type_test.go */

package seam

import (
	"testing"
)

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
