/* src/server/core/typescript/src/page/route-matcher.ts */

interface CompiledRoute {
  segments: RouteSegment[];
}

type RouteSegment =
  | { kind: "static"; value: string }
  | { kind: "param"; name: string }
  | { kind: "catch-all"; name: string; optional: boolean };

function compileRoute(pattern: string): CompiledRoute {
  const segments: RouteSegment[] = pattern
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      if (seg.startsWith("*")) {
        const optional = seg.endsWith("?");
        const name = optional ? seg.slice(1, -1) : seg.slice(1);
        return { kind: "catch-all" as const, name, optional };
      }
      if (seg.startsWith(":")) {
        return { kind: "param" as const, name: seg.slice(1) };
      }
      return { kind: "static" as const, value: seg };
    });
  return { segments };
}

function matchRoute(segments: RouteSegment[], pathParts: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "catch-all") {
      // Catch-all must be the last segment
      const rest = pathParts.slice(i);
      if (rest.length === 0 && !seg.optional) return null;
      params[seg.name] = rest.join("/");
      return params;
    }
    if (i >= pathParts.length) return null;
    if (seg.kind === "static") {
      if (seg.value !== pathParts[i]) return null;
    } else {
      params[seg.name] = pathParts[i];
    }
  }
  // All segments consumed — path must also be fully consumed
  if (segments.length !== pathParts.length) return null;
  return params;
}

export class RouteMatcher<T> {
  private routes: { pattern: string; compiled: CompiledRoute; value: T }[] = [];

  add(pattern: string, value: T): void {
    this.routes.push({ pattern, compiled: compileRoute(pattern), value });
  }

  match(path: string): { value: T; params: Record<string, string>; pattern: string } | null {
    const parts = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      const params = matchRoute(route.compiled.segments, parts);
      if (params) return { value: route.value, params, pattern: route.pattern };
    }
    return null;
  }
}
