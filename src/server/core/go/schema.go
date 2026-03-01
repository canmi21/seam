/* src/server/core/go/schema.go */

package seam

import (
	"reflect"
	"strings"
)

// SchemaOf generates a JTD (JSON Type Definition) schema from a Go type
// using reflection. The output matches the Rust SeamType derive macro.
func SchemaOf[T any]() any {
	var zero T
	return schemaFor(reflect.TypeOf(zero))
}

func schemaFor(t reflect.Type) any {
	// Unwrap pointer for the underlying type analysis;
	// pointer-ness is handled at the struct field level (nullable in properties).
	if t.Kind() == reflect.Ptr {
		return schemaFor(t.Elem())
	}

	switch t.Kind() {
	case reflect.String:
		return map[string]any{"type": "string"}

	case reflect.Bool:
		return map[string]any{"type": "boolean"}

	case reflect.Int8:
		return map[string]any{"type": "int8"}
	case reflect.Int16:
		return map[string]any{"type": "int16"}
	case reflect.Int32:
		return map[string]any{"type": "int32"}
	case reflect.Int, reflect.Int64:
		// JTD has no int64; map to int32 like Rust does
		return map[string]any{"type": "int32"}

	case reflect.Uint8:
		return map[string]any{"type": "uint8"}
	case reflect.Uint16:
		return map[string]any{"type": "uint16"}
	case reflect.Uint32:
		return map[string]any{"type": "uint32"}
	case reflect.Uint, reflect.Uint64:
		return map[string]any{"type": "uint32"}

	case reflect.Float32:
		return map[string]any{"type": "float32"}
	case reflect.Float64:
		return map[string]any{"type": "float64"}

	case reflect.Slice:
		return map[string]any{"elements": schemaFor(t.Elem())}

	case reflect.Map:
		if t.Key().Kind() == reflect.String {
			return map[string]any{"values": schemaFor(t.Elem())}
		}
		return map[string]any{"type": "string"}

	case reflect.Struct:
		return schemaForStruct(t)

	default:
		return map[string]any{"type": "string"}
	}
}

func schemaForStruct(t reflect.Type) any {
	props := make(map[string]any)
	optProps := make(map[string]any)

	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() {
			continue
		}

		name, omit := jsonFieldName(field)
		if name == "-" {
			continue
		}

		isPtr := field.Type.Kind() == reflect.Ptr

		if omit {
			// omitempty: field may be absent (optionalProperties)
			inner := field.Type
			if isPtr {
				inner = inner.Elem()
			}
			schema := schemaFor(inner)
			if isPtr {
				if m, ok := schema.(map[string]any); ok {
					m["nullable"] = true
				}
			}
			optProps[name] = schema
		} else if isPtr {
			// Pointer without omitempty: required but nullable (properties + nullable)
			inner := field.Type.Elem()
			schema := schemaFor(inner)
			if m, ok := schema.(map[string]any); ok {
				m["nullable"] = true
			}
			props[name] = schema
		} else {
			props[name] = schemaFor(field.Type)
		}
	}

	result := map[string]any{"properties": props}
	if len(optProps) > 0 {
		result["optionalProperties"] = optProps
	}
	return result
}

// jsonFieldName extracts the JSON key from the struct tag and whether omitempty is set.
func jsonFieldName(f reflect.StructField) (string, bool) {
	tag := f.Tag.Get("json")
	if tag == "" {
		return f.Name, false
	}

	parts := strings.Split(tag, ",")
	name := parts[0]
	if name == "" {
		name = f.Name
	}

	omitempty := false
	for _, opt := range parts[1:] {
		if opt == "omitempty" {
			omitempty = true
		}
	}
	return name, omitempty
}