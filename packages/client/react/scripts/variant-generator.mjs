/* packages/client/react/scripts/variant-generator.mjs */

/**
 * Walk a JTD schema + mock data to discover all structural axes.
 * Each axis represents a dimension that affects template structure:
 * boolean fields, enum fields, nullable fields, array (elements) fields.
 */
export function collectStructuralAxes(schema, mock, prefix = "") {
  const axes = [];
  if (!schema || typeof schema !== "object") return axes;

  const props = schema.properties || {};
  const optProps = schema.optionalProperties || {};
  const allProps = { ...props, ...optProps };

  for (const [key, fieldSchema] of Object.entries(allProps)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (fieldSchema.type === "boolean") {
      axes.push({ path, kind: "boolean", values: [true, false] });
    } else if (fieldSchema.enum) {
      axes.push({ path, kind: "enum", values: [...fieldSchema.enum] });
    } else if (fieldSchema.nullable) {
      axes.push({ path, kind: "nullable", values: ["present", "null"] });
      // Recurse into the underlying schema (remove nullable flag)
      const innerSchema = { ...fieldSchema };
      delete innerSchema.nullable;
      if (innerSchema.properties || innerSchema.optionalProperties) {
        const mockValue = mock?.[key];
        axes.push(...collectStructuralAxes(innerSchema, mockValue, path));
      }
    } else if (fieldSchema.elements) {
      axes.push({ path, kind: "array", values: ["populated", "empty"] });
      // Recurse into element schema with $.prefix
      const elemSchema = fieldSchema.elements;
      const mockArray = mock?.[key];
      const elemMock = Array.isArray(mockArray) && mockArray.length > 0 ? mockArray[0] : {};
      if (elemSchema.properties || elemSchema.optionalProperties) {
        axes.push(...collectStructuralAxes(elemSchema, elemMock, `${path}.$`));
      }
    } else if (fieldSchema.properties || fieldSchema.optionalProperties) {
      // Nested object: recurse
      const mockValue = mock?.[key];
      axes.push(...collectStructuralAxes(fieldSchema, mockValue, path));
    }
    // string/number/etc: non-structural, skip
  }

  return axes;
}

/**
 * Compute cartesian product of all axis values.
 * Returns array of variant objects, e.g. [{ isAdmin: true, role: "admin" }, ...]
 */
export function cartesianProduct(axes) {
  if (axes.length === 0) return [{}];

  let combos = [{}];
  for (const axis of axes) {
    const next = [];
    for (const existing of combos) {
      for (const value of axis.values) {
        next.push({ ...existing, [axis.path]: value });
      }
    }
    combos = next;
  }

  if (combos.length > 10000) {
    console.error(`warning: ${combos.length} variants detected — build may be slow`);
  }

  return combos;
}

/**
 * Build sentinel data with structural fields set according to a variant combo.
 * Uses the base sentinel as starting point and adjusts structural fields.
 */
export function buildVariantSentinel(baseSentinel, mock, variant) {
  const result = JSON.parse(JSON.stringify(baseSentinel));

  for (const [path, value] of Object.entries(variant)) {
    applyVariantValue(result, mock, path, value);
  }

  return result;
}

function applyVariantValue(sentinel, mock, path, value) {
  // Handle $.prefixed paths (inside arrays) — these modify the element template
  if (path.includes(".$")) {
    const parts = path.split(".$.");
    const arrayPath = parts[0];
    const innerPath = parts.slice(1).join(".$.");
    const arr = getNestedValue(sentinel, arrayPath);
    if (Array.isArray(arr) && arr.length > 0) {
      for (const item of arr) {
        applyVariantValue(item, getNestedValue(mock, arrayPath)?.[0] || {}, innerPath, value);
      }
    }
    return;
  }

  const pathParts = path.split(".");

  if (value === "null") {
    setNestedValue(sentinel, pathParts, null);
  } else if (value === "empty") {
    setNestedValue(sentinel, pathParts, []);
  } else if (value === "populated") {
    // Already populated from base sentinel, no change needed
  } else if (value === "present") {
    // Already present from base sentinel, no change needed
  } else if (value === true || value === false) {
    setNestedValue(sentinel, pathParts, value);
  } else if (typeof value === "string") {
    // Enum value: set the field to the actual value
    setNestedValue(sentinel, pathParts, value);
  }
}

function getNestedValue(obj, dottedPath) {
  const parts = dottedPath.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function setNestedValue(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === null || cur[parts[i]] === undefined || typeof cur[parts[i]] !== "object")
      return;
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
