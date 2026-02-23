/* packages/server/injector/native/src/resolve.ts */

export function resolve(path: string, data: Record<string, unknown>): unknown {
  const keys = path.split(".");
  let current: unknown = data;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
