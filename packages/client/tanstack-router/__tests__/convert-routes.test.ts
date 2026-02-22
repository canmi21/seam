/* packages/client/tanstack-router/__tests__/convert-routes.test.ts */

import { describe, expect, it } from "vitest";
import { convertPath } from "../src/convert-routes.js";

describe("convertPath()", () => {
  it("converts :param to $param", () => {
    expect(convertPath("/dashboard/:username")).toBe("/dashboard/$username");
  });

  it("handles multiple params", () => {
    expect(convertPath("/org/:org/repo/:repo")).toBe("/org/$org/repo/$repo");
  });

  it("leaves static paths unchanged", () => {
    expect(convertPath("/")).toBe("/");
    expect(convertPath("/about")).toBe("/about");
  });

  it("handles single param segment", () => {
    expect(convertPath("/:id")).toBe("/$id");
  });
});
