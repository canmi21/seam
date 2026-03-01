/* src/client/tanstack-router/__tests__/route-matcher.test.ts */

import { describe, expect, it } from "vitest";
import { matchSeamRoute } from "../src/route-matcher.js";

describe("matchSeamRoute()", () => {
  const patterns = ["/", "/dashboard/:username", "/org/:org/repo/:repo"];

  it("matches root path", () => {
    const result = matchSeamRoute(patterns, "/");
    expect(result).toEqual({ path: "/", params: {} });
  });

  it("matches single param", () => {
    const result = matchSeamRoute(patterns, "/dashboard/octocat");
    expect(result).toEqual({
      path: "/dashboard/:username",
      params: { username: "octocat" },
    });
  });

  it("matches multiple params", () => {
    const result = matchSeamRoute(patterns, "/org/facebook/repo/react");
    expect(result).toEqual({
      path: "/org/:org/repo/:repo",
      params: { org: "facebook", repo: "react" },
    });
  });

  it("returns null for unmatched path", () => {
    const result = matchSeamRoute(patterns, "/unknown/path/here");
    expect(result).toBeNull();
  });

  it("returns null for partial match", () => {
    const result = matchSeamRoute(patterns, "/dashboard");
    expect(result).toBeNull();
  });
});
