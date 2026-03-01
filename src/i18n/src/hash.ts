/* src/i18n/src/hash.ts */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a 32-bit hash (identical output to Rust build-time implementation) */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** Route hash: full 32-bit FNV-1a as 8 hex characters */
export function routeHash(pattern: string): string {
  return fnv1a32(pattern).toString(16).padStart(8, "0");
}
