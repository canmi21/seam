/* src/server/engine/js/__tests__/bridge.test.ts */

import { describe, expect, it } from "vitest";
import { inject, injectNoScript, asciiEscapeJson, parseBuildOutput } from "../src/index.js";

describe("inject", () => {
  const TEMPLATE = "<html><head></head><body><!--seam:content--></body></html>";

  it("injects data with default dataId", () => {
    const result = inject(TEMPLATE, { x: 1 });
    expect(result).toContain('id="__data"');
    expect(result).toContain('"x":1');
  });

  it("injects data with custom dataId", () => {
    const result = inject(TEMPLATE, { key: "val" }, { dataId: "__custom" });
    expect(result).toContain('id="__custom"');
  });

  it("skips data script when skipDataScript is true", () => {
    const result = inject(TEMPLATE, { x: 1 }, { skipDataScript: true });
    expect(result).not.toContain("<script");
  });

  it("handles empty data object", () => {
    const result = inject(TEMPLATE, {});
    expect(result).toContain('id="__data"');
  });
});

describe("injectNoScript", () => {
  it("injects without script tag", () => {
    const template = "<html><head></head><body></body></html>";
    const result = injectNoScript(template, '{"a":1}');
    expect(result).not.toContain("<script");
  });
});

describe("asciiEscapeJson", () => {
  it("escapes non-ASCII characters to unicode sequences", () => {
    const result = asciiEscapeJson('{"k":"你好"}');
    expect(result).toContain("\\u");
    expect(result).not.toContain("你");
  });

  it("leaves ASCII-only JSON unchanged", () => {
    const input = '{"k":"hello"}';
    expect(asciiEscapeJson(input)).toBe(input);
  });

  it("handles empty object", () => {
    expect(asciiEscapeJson("{}")).toBe("{}");
  });
});

describe("parseBuildOutput", () => {
  it("parses minimal manifest JSON", () => {
    const manifest = JSON.stringify({
      routes: { "/": { template: "<html></html>", layouts: [] } },
      assets: {},
    });
    const result = parseBuildOutput(manifest);
    const parsed = JSON.parse(result);
    expect(parsed).toBeDefined();
  });
});
