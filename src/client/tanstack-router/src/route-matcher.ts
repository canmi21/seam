/* src/client/tanstack-router/src/route-matcher.ts */

/** Match a pathname against SeamJS route patterns, extracting params */
export function matchSeamRoute(
  patterns: string[],
  pathname: string,
): { path: string; params: Record<string, string> } | null {
  const pathParts = pathname.split("/").filter(Boolean);

  for (const pattern of patterns) {
    const segments = pattern.split("/").filter(Boolean);
    if (segments.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < segments.length; i++) {
      if (segments[i].startsWith(":")) {
        params[segments[i].slice(1)] = pathParts[i];
      } else if (segments[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }

    if (matched) return { path: pattern, params };
  }

  return null;
}
