/* src/client/react/src/sentinel.ts */

/**
 * Replace every leaf value in `obj` with a sentinel string `%%SEAM:dotted.path%%`.
 * Nested objects are recursed; primitives and null become leaf sentinels.
 *
 * Arrays of objects (length > 0, first element is object) produce a 1-element
 * sentinel array where each leaf in the object template uses `$.` path prefix.
 * Arrays of primitives, empty arrays, and null remain leaf sentinels.
 */
export function buildSentinelData(
  obj: Record<string, unknown>,
  prefix = "",
  htmlPaths?: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = buildSentinelData(value as Record<string, unknown>, path, htmlPaths);
    } else if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0] !== null
    ) {
      // Array of objects: produce 1-element sentinel array with $.field paths
      result[key] = [
        buildSentinelData(value[0] as Record<string, unknown>, `${path}.$`, htmlPaths),
      ];
    } else {
      const suffix = htmlPaths?.has(path) ? ":html" : "";
      result[key] = `%%SEAM:${path}${suffix}%%`;
    }
  }
  return result;
}
