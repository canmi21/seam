/* packages/server/core/typescript/__tests__/route-matcher.test.ts */

import { describe, expect, it } from "vitest";
import { RouteMatcher } from "../src/page/route-matcher.js";

describe("RouteMatcher", () => {
  it("matches static route exactly", () => {
    const m = new RouteMatcher<string>();
    m.add("/about", "about-page");

    const result = m.match("/about");
    expect(result).toEqual({ value: "about-page", params: {} });
  });

  it("returns null for no match", () => {
    const m = new RouteMatcher<string>();
    m.add("/about", "about-page");

    expect(m.match("/contact")).toBeNull();
  });

  it("extracts single param", () => {
    const m = new RouteMatcher<string>();
    m.add("/user/:id", "user-page");

    const result = m.match("/user/42");
    expect(result).toEqual({ value: "user-page", params: { id: "42" } });
  });

  it("extracts multiple params", () => {
    const m = new RouteMatcher<string>();
    m.add("/org/:orgId/repo/:repoId", "repo-page");

    const result = m.match("/org/acme/repo/seam");
    expect(result).toEqual({
      value: "repo-page",
      params: { orgId: "acme", repoId: "seam" },
    });
  });

  it("returns null for wrong segment count", () => {
    const m = new RouteMatcher<string>();
    m.add("/user/:id", "user-page");

    expect(m.match("/user")).toBeNull();
    expect(m.match("/user/1/extra")).toBeNull();
  });

  it("returns null for wrong static segment", () => {
    const m = new RouteMatcher<string>();
    m.add("/user/:id", "user-page");

    expect(m.match("/post/1")).toBeNull();
  });

  it("first registered route wins on conflict", () => {
    const m = new RouteMatcher<string>();
    m.add("/item/:id", "first");
    m.add("/item/:slug", "second");

    const result = m.match("/item/abc");
    expect(result?.value).toBe("first");
  });

  it("matches root path", () => {
    const m = new RouteMatcher<string>();
    m.add("/", "home");

    const result = m.match("/");
    expect(result).toEqual({ value: "home", params: {} });
  });
});
