/* src/client/react/__tests__/use-seam-data.test.ts */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useSeamData, SeamDataProvider } from "../src/index.js";

// Helper component that renders useSeamData() result as JSON
function DataCapture() {
  const data = useSeamData();
  return createElement("pre", null, JSON.stringify(data));
}

describe("useSeamData", () => {
  it("returns provided data from SeamDataProvider", () => {
    const data = { user: { id: 1, name: "Alice" } };
    const html = renderToString(
      createElement(SeamDataProvider, { value: data }, createElement(DataCapture)),
    );
    // renderToString HTML-escapes quotes; decode before comparing
    const decoded = html.replace(/<\/?pre>/g, "").replaceAll("&quot;", '"');
    expect(JSON.parse(decoded)).toEqual(data);
  });

  it("throws when used outside SeamDataProvider", () => {
    expect(() => renderToString(createElement(DataCapture))).toThrow(
      "useSeamData must be used inside <SeamDataProvider>",
    );
  });

  it("throws when provider value is null", () => {
    expect(() =>
      renderToString(createElement(SeamDataProvider, { value: null }, createElement(DataCapture))),
    ).toThrow("useSeamData must be used inside <SeamDataProvider>");
  });
});
