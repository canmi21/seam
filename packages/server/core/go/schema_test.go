/* packages/server/core/go/schema_test.go */

package seam

import (
	"encoding/json"
	"testing"
)

func mustMarshal(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func TestSchemaOfPrimitives(t *testing.T) {
	cases := []struct {
		name string
		got  any
		want string
	}{
		{"string", SchemaOf[string](), `{"type":"string"}`},
		{"bool", SchemaOf[bool](), `{"type":"boolean"}`},
		{"int32", SchemaOf[int32](), `{"type":"int32"}`},
		{"uint32", SchemaOf[uint32](), `{"type":"uint32"}`},
		{"float64", SchemaOf[float64](), `{"type":"float64"}`},
		{"int", SchemaOf[int](), `{"type":"int32"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mustMarshal(t, tc.got)
			if got != tc.want {
				t.Errorf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestSchemaOfSlice(t *testing.T) {
	got := mustMarshal(t, SchemaOf[[]string]())
	want := `{"elements":{"type":"string"}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

type SimpleStruct struct {
	Name string `json:"name"`
	Age  int32  `json:"age"`
}

func TestSchemaOfStruct(t *testing.T) {
	got := mustMarshal(t, SchemaOf[SimpleStruct]())
	want := `{"properties":{"age":{"type":"int32"},"name":{"type":"string"}}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

type WithOptional struct {
	ID     uint32  `json:"id"`
	Name   string  `json:"name"`
	Avatar *string `json:"avatar,omitempty"`
}

func TestSchemaOfOptional(t *testing.T) {
	got := mustMarshal(t, SchemaOf[WithOptional]())
	want := `{"optionalProperties":{"avatar":{"nullable":true,"type":"string"}},"properties":{"id":{"type":"uint32"},"name":{"type":"string"}}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

// Pointer field without omitempty: required but nullable (properties + nullable)
type WithNullable struct {
	ID   uint32  `json:"id"`
	Name *string `json:"name"`
}

func TestSchemaOfNullable(t *testing.T) {
	got := mustMarshal(t, SchemaOf[WithNullable]())
	want := `{"properties":{"id":{"type":"uint32"},"name":{"nullable":true,"type":"string"}}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

type EmptyStruct struct{}

func TestSchemaOfEmptyStruct(t *testing.T) {
	got := mustMarshal(t, SchemaOf[EmptyStruct]())
	want := `{"properties":{}}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}
