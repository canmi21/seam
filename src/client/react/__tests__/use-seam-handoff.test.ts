/* src/client/react/__tests__/use-seam-handoff.test.ts */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useSeamHandoff, SeamHandoffProvider } from "../src/index.js";

function HandoffCapture() {
  const keys = useSeamHandoff();
  return createElement("pre", null, JSON.stringify(keys));
}

describe("useSeamHandoff", () => {
  it("returns empty array by default", () => {
    const html = renderToString(createElement(HandoffCapture));
    const decoded = html.replace(/<\/?pre>/g, "");
    expect(JSON.parse(decoded)).toEqual([]);
  });

  it("returns handoff keys from provider", () => {
    const html = renderToString(
      createElement(SeamHandoffProvider, { value: ["theme"] }, createElement(HandoffCapture)),
    );
    const decoded = html.replace(/<\/?pre>/g, "").replaceAll("&quot;", '"');
    expect(JSON.parse(decoded)).toEqual(["theme"]);
  });
});
