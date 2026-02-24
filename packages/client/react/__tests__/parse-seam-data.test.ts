/* packages/client/react/__tests__/parse-seam-data.test.ts */

import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSeamData } from "../src/use-seam-data.js";

function stubDocument(el: { textContent: string | null } | null) {
  vi.stubGlobal("document", {
    getElementById: vi.fn().mockReturnValue(el),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseSeamData", () => {
  it("parses valid __SEAM_DATA__ script tag", () => {
    const data = { user: { id: 1 }, items: [1, 2, 3] };
    stubDocument({ textContent: JSON.stringify(data) });

    expect(parseSeamData()).toEqual(data);
    expect(document.getElementById).toHaveBeenCalledWith("__SEAM_DATA__");
  });

  it("throws when element is missing", () => {
    stubDocument(null);
    expect(() => parseSeamData()).toThrow("__SEAM_DATA__ not found");
  });

  it("throws when textContent is empty", () => {
    stubDocument({ textContent: "" });
    expect(() => parseSeamData()).toThrow("__SEAM_DATA__ not found");
  });

  it("throws when textContent is null", () => {
    stubDocument({ textContent: null });
    expect(() => parseSeamData()).toThrow("__SEAM_DATA__ not found");
  });

  it("throws on malformed JSON", () => {
    stubDocument({ textContent: "{invalid json" });
    expect(() => parseSeamData()).toThrow();
  });

  it("accepts custom dataId parameter", () => {
    const data = { count: 42 };
    stubDocument({ textContent: JSON.stringify(data) });

    expect(parseSeamData("__sd")).toEqual(data);
    expect(document.getElementById).toHaveBeenCalledWith("__sd");
  });

  it("throws with custom dataId in error message", () => {
    stubDocument(null);
    expect(() => parseSeamData("__sd")).toThrow("__sd not found");
  });
});
