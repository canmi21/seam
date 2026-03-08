/* src/server/core/go/validation.go */

package seam

import (
	"fmt"
	"math"
	"os"
	"strings"
)

// ValidationMode controls when input validation is applied.
type ValidationMode string

const (
	ValidationModeDev    ValidationMode = "dev"    // validate in dev mode only (default)
	ValidationModeAlways ValidationMode = "always" // always validate
	ValidationModeNever  ValidationMode = "never"  // never validate
)

func shouldValidateMode(mode ValidationMode) bool {
	switch mode {
	case ValidationModeNever:
		return false
	case ValidationModeAlways:
		return true
	default:
		// dev mode: skip validation when running in production
		if env := os.Getenv("SEAM_ENV"); env == "production" {
			return false
		}
		if env := os.Getenv("NODE_ENV"); env == "production" {
			return false
		}
		return true
	}
}

// ValidationDetail describes a single validation error at a specific path.
type ValidationDetail struct {
	Path     string `json:"path"`
	Expected string `json:"expected"`
	Actual   string `json:"actual"`
}

type schemaKind int

const (
	kindEmpty schemaKind = iota
	kindType
	kindEnum
	kindElements
	kindValues
	kindProperties
	kindDiscriminator
	kindNullable
)

type namedSchema struct {
	name   string
	schema *compiledSchema
}

type compiledSchema struct {
	kind       schemaKind
	jtdType    string                     // for kindType
	enumValues []string                   // for kindEnum
	inner      *compiledSchema            // for kindElements, kindValues, kindNullable
	required   []namedSchema              // for kindProperties
	optional   []namedSchema              // for kindProperties
	allowExtra bool                       // for kindProperties (additionalProperties)
	tag        string                     // for kindDiscriminator
	mapping    map[string]*compiledSchema // for kindDiscriminator
}

const (
	maxErrorsDefault = 10
	maxDepthDefault  = 32
)

// ValidateInput compiles a JTD schema and validates data against it.
// Returns empty string and nil details if valid.
func ValidateInput(schema, data any) (string, []ValidationDetail) {
	cs, err := compileSchema(schema)
	if err != nil {
		return fmt.Sprintf("invalid schema: %v", err), nil
	}
	return validateCompiled(cs, data)
}

func validateCompiled(cs *compiledSchema, data any) (string, []ValidationDetail) {
	var errors []ValidationDetail
	validateValue(cs, data, nil, &errors, maxErrorsDefault, 0, maxDepthDefault, "")
	if len(errors) == 0 {
		return "", nil
	}
	return "input validation failed", errors
}

func compileSchema(schema any) (*compiledSchema, error) {
	m, ok := schema.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("schema must be an object")
	}
	var defs map[string]any
	if d, ok := m["definitions"]; ok {
		defs, ok = d.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("definitions must be an object")
		}
	}
	return compileInner(m, defs)
}

func compileInner(schema, defs map[string]any) (*compiledSchema, error) {
	nullable, _ := schema["nullable"].(bool)

	// handle ref
	if ref, ok := schema["ref"]; ok {
		refName, ok := ref.(string)
		if !ok {
			return nil, fmt.Errorf("ref must be a string")
		}
		if defs == nil {
			return nil, fmt.Errorf("ref %q but no definitions", refName)
		}
		defRaw, ok := defs[refName]
		if !ok {
			return nil, fmt.Errorf("ref %q not found in definitions", refName)
		}
		defMap, ok := defRaw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("definition %q must be an object", refName)
		}
		inner, err := compileInner(defMap, defs)
		if err != nil {
			return nil, err
		}
		if nullable {
			return &compiledSchema{kind: kindNullable, inner: inner}, nil
		}
		return inner, nil
	}

	// handle type
	if t, ok := schema["type"]; ok {
		ts, ok := t.(string)
		if !ok {
			return nil, fmt.Errorf("type must be a string")
		}
		cs := &compiledSchema{kind: kindType, jtdType: ts}
		if nullable {
			return &compiledSchema{kind: kindNullable, inner: cs}, nil
		}
		return cs, nil
	}

	// handle enum
	if e, ok := schema["enum"]; ok {
		arr, ok := e.([]any)
		if !ok {
			return nil, fmt.Errorf("enum must be an array")
		}
		values := make([]string, len(arr))
		for i, v := range arr {
			s, ok := v.(string)
			if !ok {
				return nil, fmt.Errorf("enum values must be strings")
			}
			values[i] = s
		}
		cs := &compiledSchema{kind: kindEnum, enumValues: values}
		if nullable {
			return &compiledSchema{kind: kindNullable, inner: cs}, nil
		}
		return cs, nil
	}

	// handle elements
	if el, ok := schema["elements"]; ok {
		elMap, ok := el.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("elements must be an object")
		}
		inner, err := compileInner(elMap, defs)
		if err != nil {
			return nil, err
		}
		cs := &compiledSchema{kind: kindElements, inner: inner}
		if nullable {
			return &compiledSchema{kind: kindNullable, inner: cs}, nil
		}
		return cs, nil
	}

	// handle values
	if v, ok := schema["values"]; ok {
		vMap, ok := v.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("values must be an object")
		}
		inner, err := compileInner(vMap, defs)
		if err != nil {
			return nil, err
		}
		cs := &compiledSchema{kind: kindValues, inner: inner}
		if nullable {
			return &compiledSchema{kind: kindNullable, inner: cs}, nil
		}
		return cs, nil
	}

	// handle properties / optionalProperties
	_, hasProps := schema["properties"]
	_, hasOptProps := schema["optionalProperties"]
	if hasProps || hasOptProps {
		cs := &compiledSchema{kind: kindProperties}
		if hasProps {
			propsMap, ok := schema["properties"].(map[string]any)
			if !ok {
				return nil, fmt.Errorf("properties must be an object")
			}
			for name, propRaw := range propsMap {
				propMap, ok := propRaw.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("property %q must be an object", name)
				}
				propSchema, err := compileInner(propMap, defs)
				if err != nil {
					return nil, err
				}
				cs.required = append(cs.required, namedSchema{name: name, schema: propSchema})
			}
		}
		if hasOptProps {
			optMap, ok := schema["optionalProperties"].(map[string]any)
			if !ok {
				return nil, fmt.Errorf("optionalProperties must be an object")
			}
			for name, propRaw := range optMap {
				propMap, ok := propRaw.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("optional property %q must be an object", name)
				}
				propSchema, err := compileInner(propMap, defs)
				if err != nil {
					return nil, err
				}
				cs.optional = append(cs.optional, namedSchema{name: name, schema: propSchema})
			}
		}
		if extra, ok := schema["additionalProperties"]; ok {
			cs.allowExtra, _ = extra.(bool)
		}
		if nullable {
			return &compiledSchema{kind: kindNullable, inner: cs}, nil
		}
		return cs, nil
	}

	// handle discriminator
	if d, ok := schema["discriminator"]; ok {
		tag, ok := d.(string)
		if !ok {
			return nil, fmt.Errorf("discriminator must be a string")
		}
		mappingRaw, ok := schema["mapping"]
		if !ok {
			return nil, fmt.Errorf("discriminator requires mapping")
		}
		mappingMap, ok := mappingRaw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("mapping must be an object")
		}
		mapping := make(map[string]*compiledSchema, len(mappingMap))
		for k, v := range mappingMap {
			vMap, ok := v.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("mapping value %q must be an object", k)
			}
			cs, err := compileInner(vMap, defs)
			if err != nil {
				return nil, err
			}
			mapping[k] = cs
		}
		cs := &compiledSchema{kind: kindDiscriminator, tag: tag, mapping: mapping}
		if nullable {
			return &compiledSchema{kind: kindNullable, inner: cs}, nil
		}
		return cs, nil
	}

	// empty schema
	cs := &compiledSchema{kind: kindEmpty}
	if nullable {
		return &compiledSchema{kind: kindNullable, inner: cs}, nil
	}
	return cs, nil
}

// discTag is the discriminator tag key to exclude from extra-property checks
// in properties validation. Empty string means no exclusion.
func validateValue(cs *compiledSchema, data any, path []string, errors *[]ValidationDetail, maxErrors, depth, maxDepth int, discTag string) {
	if len(*errors) >= maxErrors || depth > maxDepth {
		return
	}

	switch cs.kind {
	case kindEmpty:
		// accepts anything

	case kindNullable:
		if data == nil {
			return
		}
		validateValue(cs.inner, data, path, errors, maxErrors, depth, maxDepth, discTag)

	case kindType:
		validateType(cs.jtdType, data, path, errors)

	case kindEnum:
		s, ok := data.(string)
		if !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: "one of [" + strings.Join(cs.enumValues, ", ") + "]",
				Actual:   typeNameOf(data),
			})
			return
		}
		for _, v := range cs.enumValues {
			if s == v {
				return
			}
		}
		*errors = append(*errors, ValidationDetail{
			Path:     pathString(path),
			Expected: "one of [" + strings.Join(cs.enumValues, ", ") + "]",
			Actual:   fmt.Sprintf("%q", s),
		})

	case kindElements:
		arr, ok := data.([]any)
		if !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: "array",
				Actual:   typeNameOf(data),
			})
			return
		}
		for i, item := range arr {
			if len(*errors) >= maxErrors {
				return
			}
			validateValue(cs.inner, item, append(path, fmt.Sprintf("%d", i)), errors, maxErrors, depth+1, maxDepth, "")
		}

	case kindValues:
		obj, ok := data.(map[string]any)
		if !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: "object",
				Actual:   typeNameOf(data),
			})
			return
		}
		for k, v := range obj {
			if len(*errors) >= maxErrors {
				return
			}
			validateValue(cs.inner, v, append(path, k), errors, maxErrors, depth+1, maxDepth, "")
		}

	case kindProperties:
		obj, ok := data.(map[string]any)
		if !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: "object",
				Actual:   typeNameOf(data),
			})
			return
		}
		seen := make(map[string]bool)
		for _, ns := range cs.required {
			seen[ns.name] = true
			v, exists := obj[ns.name]
			if !exists {
				*errors = append(*errors, ValidationDetail{
					Path:     pathString(append(path, ns.name)),
					Expected: "required",
					Actual:   "missing",
				})
				continue
			}
			if len(*errors) >= maxErrors {
				return
			}
			validateValue(ns.schema, v, append(path, ns.name), errors, maxErrors, depth+1, maxDepth, "")
		}
		for _, ns := range cs.optional {
			seen[ns.name] = true
			v, exists := obj[ns.name]
			if !exists {
				continue
			}
			if len(*errors) >= maxErrors {
				return
			}
			validateValue(ns.schema, v, append(path, ns.name), errors, maxErrors, depth+1, maxDepth, "")
		}
		if !cs.allowExtra {
			for k := range obj {
				if !seen[k] && k != discTag {
					*errors = append(*errors, ValidationDetail{
						Path:     pathString(append(path, k)),
						Expected: "no extra properties",
						Actual:   "unexpected property",
					})
					if len(*errors) >= maxErrors {
						return
					}
				}
			}
		}

	case kindDiscriminator:
		obj, ok := data.(map[string]any)
		if !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(path),
				Expected: "object",
				Actual:   typeNameOf(data),
			})
			return
		}
		tagVal, exists := obj[cs.tag]
		if !exists {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(append(path, cs.tag)),
				Expected: "discriminator tag",
				Actual:   "missing",
			})
			return
		}
		tagStr, ok := tagVal.(string)
		if !ok {
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(append(path, cs.tag)),
				Expected: "string",
				Actual:   typeNameOf(tagVal),
			})
			return
		}
		branch, ok := cs.mapping[tagStr]
		if !ok {
			keys := make([]string, 0, len(cs.mapping))
			for k := range cs.mapping {
				keys = append(keys, k)
			}
			*errors = append(*errors, ValidationDetail{
				Path:     pathString(append(path, cs.tag)),
				Expected: "one of [" + strings.Join(keys, ", ") + "]",
				Actual:   fmt.Sprintf("%q", tagStr),
			})
			return
		}
		validateValue(branch, data, path, errors, maxErrors, depth+1, maxDepth, cs.tag)
	}
}

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
