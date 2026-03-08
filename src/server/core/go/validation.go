/* src/server/core/go/validation.go */

package seam

import (
	"fmt"
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
