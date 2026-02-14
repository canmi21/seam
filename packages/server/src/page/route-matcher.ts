export interface MatchResult {
  params: Record<string, string>;
}

interface CompiledRoute {
  segments: RouteSegment[];
  pattern: string;
}

type RouteSegment =
  | { kind: "static"; value: string }
  | { kind: "param"; name: string };

function compileRoute(pattern: string): CompiledRoute {
  const segments: RouteSegment[] = pattern
    .split("/")
    .filter(Boolean)
    .map((seg) =>
      seg.startsWith(":")
        ? { kind: "param", name: seg.slice(1) }
        : { kind: "static", value: seg },
    );
  return { segments, pattern };
}

function matchRoute(
  segments: RouteSegment[],
  pathParts: string[],
): Record<string, string> | null {
  if (segments.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "static") {
      if (seg.value !== pathParts[i]) return null;
    } else {
      params[seg.name] = pathParts[i];
    }
  }
  return params;
}

export class RouteMatcher<T> {
  private routes: { compiled: CompiledRoute; value: T }[] = [];

  add(pattern: string, value: T): void {
    this.routes.push({ compiled: compileRoute(pattern), value });
  }

  match(path: string): { value: T; params: Record<string, string> } | null {
    const parts = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      const params = matchRoute(route.compiled.segments, parts);
      if (params) return { value: route.value, params };
    }
    return null;
  }
}
