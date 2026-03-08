/* src/server/core/go/validation_compile.go */

package seam

import "fmt"

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
