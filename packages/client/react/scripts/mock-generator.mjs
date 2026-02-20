/* packages/client/react/scripts/mock-generator.mjs */

/**
 * Auto-generate deterministic mock data from JTD schema.
 * Lets users omit mock in route definitions when a manifest is available.
 */

const STRING_RULES = [
  { test: (f) => /name/i.test(f), value: "Example Name" },
  { test: (f) => /url|href|src/i.test(f), value: "https://example.com" },
  { test: (f) => /email/i.test(f), value: "user@example.com" },
  { test: (f) => /color/i.test(f), value: "#888888" },
  { test: (f) => /description|bio|summary/i.test(f), value: "Sample description" },
  { test: (f) => /title/i.test(f), value: "Sample Title" },
  { test: (f) => /^id$/i.test(f), value: "sample-id" },
];

function inferStringValue(fieldPath) {
  const lastSegment = fieldPath ? fieldPath.split(".").pop() : "";
  for (const rule of STRING_RULES) {
    if (rule.test(lastSegment)) return rule.value;
  }
  // Capitalize first letter for readability
  const label = lastSegment ? lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1) : "text";
  return `Sample ${label}`;
}

/**
 * Recursively traverse a JTD schema and produce deterministic mock values.
 * @param {object} schema - JTD schema node
 * @param {string} [fieldPath=""] - dot-separated path for semantic string inference
 * @returns {unknown}
 */
export function generateMockFromSchema(schema, fieldPath = "") {
  if (!schema || typeof schema !== "object") return {};

  // Strip nullable wrapper — generate a populated (non-null) value
  if (schema.nullable) {
    const inner = { ...schema };
    delete inner.nullable;
    return generateMockFromSchema(inner, fieldPath);
  }

  // Primitive type forms
  if (schema.type) {
    switch (schema.type) {
      case "string":
        return inferStringValue(fieldPath);
      case "boolean":
        return true;
      case "int8":
      case "int16":
      case "int32":
      case "uint8":
      case "uint16":
      case "uint32":
      case "float32":
      case "float64":
        return 1;
      case "timestamp":
        return "2024-01-01T00:00:00Z";
      default:
        return `Sample ${schema.type}`;
    }
  }

  // Enum form
  if (schema.enum) {
    return schema.enum[0];
  }

  // Object form (properties / optionalProperties)
  if (schema.properties || schema.optionalProperties) {
    const result = {};
    const props = schema.properties || {};
    const optProps = schema.optionalProperties || {};
    for (const [key, sub] of Object.entries(props)) {
      result[key] = generateMockFromSchema(sub, fieldPath ? `${fieldPath}.${key}` : key);
    }
    for (const [key, sub] of Object.entries(optProps)) {
      result[key] = generateMockFromSchema(sub, fieldPath ? `${fieldPath}.${key}` : key);
    }
    return result;
  }

  // Array form (elements)
  if (schema.elements) {
    return [
      generateMockFromSchema(schema.elements, fieldPath ? `${fieldPath}.$` : "$"),
      generateMockFromSchema(schema.elements, fieldPath ? `${fieldPath}.$` : "$"),
    ];
  }

  // Record/map form (values)
  if (schema.values) {
    return {
      item1: generateMockFromSchema(schema.values, fieldPath ? `${fieldPath}.item1` : "item1"),
      item2: generateMockFromSchema(schema.values, fieldPath ? `${fieldPath}.item2` : "item2"),
    };
  }

  // Discriminator form (tagged union)
  if (schema.discriminator && schema.mapping) {
    const tag = schema.discriminator;
    const mappingKeys = Object.keys(schema.mapping);
    if (mappingKeys.length === 0) return { [tag]: "" };
    const firstKey = mappingKeys[0];
    const variant = generateMockFromSchema(schema.mapping[firstKey], fieldPath);
    return { [tag]: firstKey, ...variant };
  }

  // Empty / any schema
  return {};
}

/**
 * Replicate page handler's merge logic: keyed loader data flattened
 * so that top-level keys from each loader's object result are also
 * accessible at the root level.
 * @param {Record<string, unknown>} keyedMock
 * @returns {Record<string, unknown>}
 */
export function flattenLoaderMock(keyedMock) {
  const flat = { ...keyedMock };
  for (const value of Object.values(keyedMock)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(flat, value);
    }
  }
  return flat;
}

/**
 * Deep merge base with override:
 * - object + object → recursive merge
 * - array in override → replaces entirely
 * - primitive/null in override → replaces
 * - keys only in base → preserved
 * @param {unknown} base
 * @param {unknown} override
 * @returns {unknown}
 */
export function deepMerge(base, override) {
  if (override === null || override === undefined) return override;
  if (typeof override !== "object" || Array.isArray(override)) return override;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return override;

  const result = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (
      key in result &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key]) &&
      typeof val === "object" &&
      val !== null &&
      !Array.isArray(val)
    ) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}
