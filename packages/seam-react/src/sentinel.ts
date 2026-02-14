/* packages/seam-react/src/sentinel.ts */

/**
 * Replace every leaf value in `obj` with a sentinel string `%%SEAM:dotted.path%%`.
 * Nested objects are recursed; arrays and primitives become leaf sentinels.
 */
export function buildSentinelData(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = buildSentinelData(value as Record<string, unknown>, path);
    } else {
      result[key] = `%%SEAM:${path}%%`;
    }
  }
  return result;
}
