/* src/server/core/go/validation_check.go */

package seam

import (
	"fmt"
	"math"
	"strings"
)

func validateType(jtdType string, data any, path []string, errors *[]ValidationDetail) {
	switch jtdType {
	case "boolean":
		if _, ok := data.(bool); !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: "boolean",
				Actual:   typeNameOf(data),
			})
		}
	case "string":
		if _, ok := data.(string); !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: "string",
				Actual:   typeNameOf(data),
			})
		}
	case "timestamp":
		s, ok := data.(string)
		if !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: "timestamp",
				Actual:   typeNameOf(data),
			})
			return
		}
		if !isTimestampLike(s) {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: "timestamp",
				Actual:   fmt.Sprintf("%q", s),
			})
		}
	case "float32", "float64":
		if _, ok := data.(float64); !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: jtdType,
				Actual:   typeNameOf(data),
			})
		}
	case "int8":
		checkIntRange(data, -128, 127, jtdType, path, errors)
	case "uint8":
		checkIntRange(data, 0, 255, jtdType, path, errors)
	case "int16":
		checkIntRange(data, -32768, 32767, jtdType, path, errors)
	case "uint16":
		checkIntRange(data, 0, 65535, jtdType, path, errors)
	case "int32":
		checkIntRange(data, -2147483648, 2147483647, jtdType, path, errors)
	case "uint32":
		checkIntRange(data, 0, 4294967295, jtdType, path, errors)
	default:
		*errors = append(*errors, ValidationDetail{
			Path:     pathString(path),
			Expected: "valid type",
			Actual:   fmt.Sprintf("unknown type %q", jtdType),
		})
	}
}

func checkIntRange(data any, lo, hi float64, typeName string, path []string, errors *[]ValidationDetail) {
	v, ok := data.(float64)
	if !ok {
		*errors = append(*errors, ValidationDetail{
			Path:     pathString(path),
			Expected: typeName,
			Actual:   typeNameOf(data),
		})
		return
	}
	if math.Floor(v) != v || v < lo || v > hi {
		*errors = append(*errors, ValidationDetail{
			Path:     pathString(path),
			Expected: typeName,
			Actual:   fmt.Sprintf("%v", data),
		})
	}
}

func isTimestampLike(s string) bool {
	// basic format: date part with digits before 'T', then time part with timezone
	tIdx := strings.IndexAny(s, "Tt")
	if tIdx < 1 {
		return false
	}
	// date part must contain at least one digit
	hasDigit := false
	for _, c := range s[:tIdx] {
		if c >= '0' && c <= '9' {
			hasDigit = true
			break
		}
	}
	if !hasDigit {
		return false
	}
	// time part must exist after T
	if tIdx >= len(s)-1 {
		return false
	}
	last := s[len(s)-1]
	if last == 'Z' || last == 'z' {
		return true
	}
	// check for timezone offset like +HH:MM or -HH:MM
	if idx := strings.LastIndexAny(s, "+-"); idx > tIdx {
		offset := s[idx:]
		if len(offset) >= 3 {
			return true
		}
	}
	return false
}

func pathString(path []string) string {
	if len(path) == 0 {
		return ""
	}
	return "/" + strings.Join(path, "/")
}

func typeNameOf(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case float64:
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return fmt.Sprintf("%T", v)
	}
}
