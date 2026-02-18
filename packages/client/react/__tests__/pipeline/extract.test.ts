/* packages/client/react/__tests__/pipeline/extract.test.ts */

import { describe, it, expect } from "vitest";
import { extractTemplate } from "./extract/index.js";
import type { Axis } from "./extract/index.js";

function makeAxis(path: string, kind: string, values: unknown[]): Axis {
  return { path, kind, values };
}

describe("extract engine: flat axes", () => {
  it("single variant passthrough", () => {
    const axes: Axis[] = [];
    const variants = ["<div>Hello</div>"];
    expect(extractTemplate(axes, variants)).toBe("<div>Hello</div>");
  });

  it("boolean if-only", () => {
    const axes = [makeAxis("isAdmin", "boolean", [true, false])];
    const variants = ["<div>Hello<span>Admin</span></div>", "<div>Hello</div>"];
    const result = extractTemplate(axes, variants);
    expect(result).toContain("<!--seam:if:isAdmin-->");
    expect(result).toContain("<span>Admin</span>");
    expect(result).toContain("<!--seam:endif:isAdmin-->");
  });

  it("boolean if-else", () => {
    const axes = [makeAxis("isLoggedIn", "boolean", [true, false])];
    const variants = ["<div><b>Welcome</b></div>", "<div><i>Login</i></div>"];
    const result = extractTemplate(axes, variants);
    expect(result).toContain("<!--seam:if:isLoggedIn-->");
    expect(result).toContain("<b>Welcome</b>");
    expect(result).toContain("<!--seam:else-->");
    expect(result).toContain("<i>Login</i>");
    expect(result).toContain("<!--seam:endif:isLoggedIn-->");
  });

  it("enum match", () => {
    const axes = [makeAxis("role", "enum", ["admin", "member", "guest"])];
    const variants = [
      "<div><b>Admin Panel</b></div>",
      "<div><i>Member Area</i></div>",
      "<div><span>Guest View</span></div>",
    ];
    const result = extractTemplate(axes, variants);
    expect(result).toContain("<!--seam:match:role-->");
    expect(result).toContain("<!--seam:when:admin-->");
    expect(result).toContain("<!--seam:when:member-->");
    expect(result).toContain("<!--seam:when:guest-->");
    expect(result).toContain("<!--seam:endmatch-->");
  });

  it("array each", () => {
    const axes = [makeAxis("posts", "array", ["populated", "empty"])];
    const variants = ["<ul><li><!--seam:posts.$.name--></li></ul>", "<ul></ul>"];
    const result = extractTemplate(axes, variants);
    expect(result).toContain("<!--seam:each:posts-->");
    expect(result).toContain("<!--seam:$.name-->");
    expect(result).toContain("<!--seam:endeach-->");
    expect(result).not.toContain("posts.$.name");
  });

  it("sibling booleans", () => {
    const axes = [
      makeAxis("isAdmin", "boolean", [true, false]),
      makeAxis("isLoggedIn", "boolean", [true, false]),
    ];
    const variants = [
      "<div><span>Admin</span><span>Welcome</span></div>", // TT
      "<div><span>Admin</span></div>", // TF
      "<div><span>Welcome</span></div>", // FT
      "<div></div>", // FF
    ];
    const result = extractTemplate(axes, variants);
    expect(result).toContain("<!--seam:if:isAdmin--><span>Admin</span><!--seam:endif:isAdmin-->");
    expect(result).toContain(
      "<!--seam:if:isLoggedIn--><span>Welcome</span><!--seam:endif:isLoggedIn-->",
    );
  });

  it("array container unwrap", () => {
    const axes = [makeAxis("items", "array", ["populated", "empty"])];
    const variants = [
      '<div><ul class="list"><li><!--seam:items.$.name--></li></ul></div>',
      "<div><p>No items</p></div>",
    ];
    const result = extractTemplate(axes, variants);
    expect(result).toContain("<ul");
    expect(result).toContain("<!--seam:each:items-->");
    expect(result).not.toContain("<!--seam:each:items--><ul");
  });
});

describe("extract engine: nested axes", () => {
  it("array with nested boolean", () => {
    const axes = [
      makeAxis("posts", "array", ["populated", "empty"]),
      makeAxis("posts.$.hasAuthor", "boolean", [true, false]),
    ];
    const variants = [
      "<ul><li>Title<span>Author</span></li></ul>",
      "<ul><li>Title</li></ul>",
      "<ul></ul>",
      "<ul></ul>",
    ];
    const result = extractTemplate(axes, variants);
    expect(result).toContain("<!--seam:each:posts-->");
    expect(result).toContain("<!--seam:if:$.hasAuthor-->");
    expect(result).toContain("<span>Author</span>");
    expect(result).toContain("<!--seam:endif:$.hasAuthor-->");
    expect(result).toContain("<!--seam:endeach-->");
    expect(result).not.toContain("posts.$.hasAuthor");
  });
});
