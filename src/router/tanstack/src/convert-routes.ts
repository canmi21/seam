/* src/router/tanstack/src/convert-routes.ts */

/** Convert SeamJS `:param` path syntax to TanStack Router `$param` syntax */
export function convertPath(seamPath: string): string {
  return seamPath.replace(/:(\w+)/g, "$$$1");
}
