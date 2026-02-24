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

  // HTML format: return sample HTML content instead of plain text
  if (schema.type === "string" && schema.metadata?.format === "html") {
    return "<p>Sample HTML content</p>";
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

/**
 * Recursively walk a JTD schema collecting dot-separated paths
 * where metadata.format === "html".
 * Returns a Set including both full paths and flattened paths
 * (first segment stripped) to match flattenLoaderMock behavior.
 * @param {object} schema - page-level JTD schema
 * @returns {Set<string>}
 */
/**
 * Walk JTD schema collecting all valid dot-separated field paths.
 * Returns a Set including both keyed paths and flattened paths
 * (first segment stripped) to match flattenLoaderMock behavior.
 * @param {object} schema - page-level JTD schema
 * @returns {Set<string>}
 */
export function collectSchemaPaths(schema) {
  const paths = new Set();

  function walk(node, prefix) {
    if (!node || typeof node !== "object") return;

    if (node.nullable) {
      const inner = { ...node };
      delete inner.nullable;
      walk(inner, prefix);
      return;
    }

    if (node.properties || node.optionalProperties) {
      for (const [key, sub] of Object.entries({
        ...node.properties,
        ...node.optionalProperties,
      })) {
        const path = prefix ? `${prefix}.${key}` : key;
        paths.add(path);
        walk(sub, path);
      }
      return;
    }

    if (node.elements) {
      walk(node.elements, prefix ? `${prefix}.$` : "$");
      return;
    }
  }

  walk(schema, "");

  // Add flattened paths (strip first segment) to match flattenLoaderMock.
  // Snapshot before iterating because we mutate paths in the loop body.
  const snapshot = Array.from(paths);
  for (const p of snapshot) {
    const dot = p.indexOf(".");
    if (dot !== -1) paths.add(p.slice(dot + 1));
  }
  return paths;
}

/**
 * Standard Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Return the closest candidate within Levenshtein distance <= 3, or null.
 * @param {string} name
 * @param {Iterable<string>} candidates
 * @returns {string | null}
 */
export function didYouMean(name, candidates) {
  let best = null;
  let bestDist = 4; // threshold: distance must be <= 3
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

// Keys to ignore in Proxy tracking — React internals, framework hooks, and prototype methods
const SKIP_KEYS = new Set([
  "$$typeof",
  "then",
  "toJSON",
  "constructor",
  "valueOf",
  "toString",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
  "_owner",
  "_store",
  "ref",
  "key",
  "type",
  "props",
  "_self",
  "_source",
]);

const ARRAY_METHODS = new Set([
  "length",
  "map",
  "filter",
  "forEach",
  "find",
  "findIndex",
  "some",
  "every",
  "reduce",
  "reduceRight",
  "includes",
  "indexOf",
  "lastIndexOf",
  "flat",
  "flatMap",
  "slice",
  "concat",
  "join",
  "sort",
  "reverse",
  "entries",
  "keys",
  "values",
  "at",
  "fill",
  "copyWithin",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
]);

/**
 * Wrap an object with a Proxy that records all property access paths into `accessed`.
 * Nested objects/arrays are recursively wrapped.
 * @param {unknown} obj - object to wrap
 * @param {Set<string>} accessed - set to record accessed paths
 * @param {string} [prefix=""] - current dot-separated path prefix
 * @returns {unknown}
 */
export function createAccessTracker(obj, accessed, prefix = "") {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;

  return new Proxy(obj, {
    get(target, prop, receiver) {
      // Skip symbols (React internals: Symbol.toPrimitive, Symbol.iterator, etc.)
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);

      // Skip framework / prototype keys
      if (SKIP_KEYS.has(prop)) return Reflect.get(target, prop, receiver);

      const isArr = Array.isArray(target);

      // Skip array methods but still wrap returned object values
      if (isArr && ARRAY_METHODS.has(prop)) {
        const val = Reflect.get(target, prop, receiver);
        return val;
      }

      // Numeric index on array — record as prefix.$
      if (isArr && /^\d+$/.test(prop)) {
        const path = prefix ? `${prefix}.$` : "$";
        accessed.add(path);
        const val = target[prop];
        if (val !== null && val !== undefined && typeof val === "object") {
          return createAccessTracker(val, accessed, path);
        }
        return val;
      }

      const path = prefix ? `${prefix}.${prop}` : prop;
      accessed.add(path);

      const val = Reflect.get(target, prop, receiver);
      if (val !== null && val !== undefined && typeof val === "object") {
        return createAccessTracker(val, accessed, path);
      }
      return val;
    },
  });
}

/**
 * Compare accessed property paths against schema-defined paths.
 * Returns an array of warning strings for fields accessed but not in schema.
 * @param {Set<string>} accessed - paths recorded by createAccessTracker
 * @param {object | null} schema - page-level JTD schema
 * @param {string} routePath - route path for warning messages
 * @returns {string[]}
 */
export function checkFieldAccess(accessed, schema, routePath) {
  if (!schema) return [];

  const known = collectSchemaPaths(schema);
  if (known.size === 0) return [];

  const warnings = [];
  // Collect leaf field names for did-you-mean suggestions
  const leafNames = new Set();
  for (const p of known) {
    const dot = p.lastIndexOf(".");
    leafNames.add(dot === -1 ? p : p.slice(dot + 1));
  }

  for (const path of accessed) {
    if (known.has(path)) continue;

    // Skip if it's a parent prefix of a known path (e.g. "user" when "user.name" exists)
    let isParent = false;
    for (const k of known) {
      if (k.startsWith(path + ".")) {
        isParent = true;
        break;
      }
    }
    if (isParent) continue;

    const fieldName = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : path;
    const suggestion = didYouMean(fieldName, leafNames);

    const knownList = [...leafNames].sort().join(", ");
    let msg = `Route "${routePath}" component accessed data.${path},\n       but schema only defines: ${knownList}`;
    if (suggestion) {
      msg += `\n       Did you mean: ${suggestion}?`;
    }
    warnings.push(msg);
  }

  return warnings;
}

export function collectHtmlPaths(schema) {
  const paths = new Set();

  function walk(node, prefix) {
    if (!node || typeof node !== "object") return;

    if (node.nullable) {
      const inner = { ...node };
      delete inner.nullable;
      walk(inner, prefix);
      return;
    }

    if (node.type === "string" && node.metadata?.format === "html") {
      paths.add(prefix);
      return;
    }

    if (node.properties || node.optionalProperties) {
      for (const [key, sub] of Object.entries(node.properties || {})) {
        walk(sub, prefix ? `${prefix}.${key}` : key);
      }
      for (const [key, sub] of Object.entries(node.optionalProperties || {})) {
        walk(sub, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    if (node.elements) {
      walk(node.elements, prefix ? `${prefix}.$` : "$");
      return;
    }
  }

  walk(schema, "");

  // Add flattened paths (strip first segment) to match flattenLoaderMock
  const flattened = new Set(paths);
  for (const p of paths) {
    const dot = p.indexOf(".");
    if (dot !== -1) {
      flattened.add(p.slice(dot + 1));
    }
  }

  return flattened;
}
