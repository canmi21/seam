/* packages/server/core/typescript/__tests__/mime.test.ts */

import { describe, expect, it } from "vitest";
import { MIME_TYPES } from "../src/mime.js";

describe("MIME_TYPES", () => {
  it("maps .js to application/javascript", () => {
    expect(MIME_TYPES[".js"]).toBe("application/javascript");
  });

  it("maps .css to text/css", () => {
    expect(MIME_TYPES[".css"]).toBe("text/css");
  });

  it("maps .json to application/json", () => {
    expect(MIME_TYPES[".json"]).toBe("application/json");
  });

  it("maps .svg to image/svg+xml", () => {
    expect(MIME_TYPES[".svg"]).toBe("image/svg+xml");
  });

  it("includes dev-only extensions from proxy", () => {
    expect(MIME_TYPES[".map"]).toBe("application/json");
    expect(MIME_TYPES[".ts"]).toBe("application/javascript");
    expect(MIME_TYPES[".tsx"]).toBe("application/javascript");
  });

  it("maps font types", () => {
    expect(MIME_TYPES[".woff"]).toBe("font/woff");
    expect(MIME_TYPES[".woff2"]).toBe("font/woff2");
  });
});
