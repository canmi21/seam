/* packages/client/react/__tests__/use-seam-navigate.test.ts */

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useSeamNavigate, SeamNavigateProvider } from "../src/index.js";

function NavCapture({ url }: { url: string }) {
  const navigate = useSeamNavigate();
  // Capture type to verify it returns a function
  return createElement("button", { onClick: () => navigate(url) }, typeof navigate);
}

describe("useSeamNavigate", () => {
  it("returns a function without provider (default)", () => {
    const html = renderToString(createElement(NavCapture, { url: "/" }));
    expect(html).toContain("function");
  });

  it("default navigates via location.href", () => {
    const original = globalThis.location;
    const mockLocation = { href: "" } as Location;
    Object.defineProperty(globalThis, "location", {
      value: mockLocation,
      writable: true,
      configurable: true,
    });

    let captured: ((url: string) => void) | null = null;
    function Capture() {
      captured = useSeamNavigate();
      return null;
    }

    renderToString(createElement(Capture));
    captured!("/test");
    expect(mockLocation.href).toBe("/test");

    Object.defineProperty(globalThis, "location", {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  it("uses provider override when wrapped", () => {
    const mockNavigate = vi.fn();

    let captured: ((url: string) => void) | null = null;
    function Capture() {
      captured = useSeamNavigate();
      return null;
    }

    renderToString(
      createElement(SeamNavigateProvider, { value: mockNavigate }, createElement(Capture)),
    );

    captured!("/dashboard/octocat");
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/octocat");
  });
});
