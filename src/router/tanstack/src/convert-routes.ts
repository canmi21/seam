/* src/router/tanstack/src/convert-routes.ts */

/** Convert SeamJS path syntax to TanStack Router syntax.
 *  - `:param` → `$param`
 *  - `/*name` or `/*name?` (catch-all) → `/$`
 */
export function convertPath(seamPath: string): string {
  return seamPath.replace(/\/\*\w+\??$/, '/$').replace(/:(\w+)/g, '$$$1')
}
