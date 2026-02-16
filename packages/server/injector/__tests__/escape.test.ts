/* packages/server/injector/__tests__/escape.test.ts */

import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/escape.js";

describe("escapeHtml", () => {
  it("escapes all special characters", () => {
    expect(escapeHtml('<script>"xss"&\'done\'</script>')).toBe(
      "&lt;script&gt;&quot;xss&quot;&amp;&#x27;done&#x27;&lt;/script&gt;",
    );
  });

  it("passes through safe strings", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("escapes ampersand alone", () => {
    expect(escapeHtml("A&B")).toBe("A&amp;B");
  });

  it("escapes only special chars, preserves rest", () => {
    expect(escapeHtml("price > 0 && price < 100")).toBe(
      "price &gt; 0 &amp;&amp; price &lt; 100",
    );
  });
});
