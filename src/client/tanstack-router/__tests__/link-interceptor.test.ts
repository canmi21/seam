/* src/client/tanstack-router/__tests__/link-interceptor.test.ts */

import { describe, it, expect, vi, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { setupLinkInterception } from "../src/link-interceptor.js";

// Minimal Router mock: only needs .navigate()
function createMockRouter() {
  return { navigate: vi.fn() } as unknown as Parameters<typeof setupLinkInterception>[0];
}

function createEnv(href = "http://localhost/") {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: href });
  const { window } = dom;
  const { document } = window;

  // Expose globals that the interceptor reads
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "location", { value: window.location, configurable: true });

  return { dom, document, window };
}

function click(el: Element, overrides: Partial<MouseEventInit> = {}): MouseEvent {
  const event = new el.ownerDocument!.defaultView!.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...overrides,
  });
  el.dispatchEvent(event);
  return event;
}

describe("setupLinkInterception - interception", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("intercepts same-origin left-click on <a>", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/dashboard/octocat";
    document.body.appendChild(a);

    const e = click(a);
    expect(e.defaultPrevented).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith({ to: "/dashboard/octocat" });
  });

  it("intercepts clicks on child elements inside <a>", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/dashboard/torvalds";
    const span = document.createElement("span");
    span.textContent = "Click me";
    a.appendChild(span);
    document.body.appendChild(a);

    const e = click(span);
    expect(e.defaultPrevented).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith({ to: "/dashboard/torvalds" });
  });

  it("preserves search and hash in navigation", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/search?q=react#results";
    document.body.appendChild(a);

    click(a);
    expect(router.navigate).toHaveBeenCalledWith({ to: "/search?q=react#results" });
  });

  it("returns cleanup function that removes listener", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    const remove = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/page";
    document.body.appendChild(a);

    remove();

    click(a);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe("setupLinkInterception - guards", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("skips non-left-click (middle button)", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/page";
    document.body.appendChild(a);

    const e = click(a, { button: 1 });
    expect(e.defaultPrevented).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("skips meta key (Cmd+click)", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/page";
    document.body.appendChild(a);

    const e = click(a, { metaKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("skips ctrl key", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/page";
    document.body.appendChild(a);

    const e = click(a, { ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
  });

  it("skips already-prevented events", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/page";
    document.body.appendChild(a);

    // Add a handler that prevents default before our interceptor
    a.addEventListener("click", (e) => e.preventDefault(), { capture: true });

    click(a);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("skips [data-seam-no-intercept] opt-out", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const container = document.createElement("div");
    container.setAttribute("data-seam-no-intercept", "");
    const a = document.createElement("a");
    a.href = "http://localhost/page";
    container.appendChild(a);
    document.body.appendChild(container);

    const e = click(a);
    expect(e.defaultPrevented).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("skips target=_blank", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/page";
    a.target = "_blank";
    document.body.appendChild(a);

    const e = click(a);
    expect(e.defaultPrevented).toBe(false);
  });

  it("skips download links", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "http://localhost/file.pdf";
    a.setAttribute("download", "");
    document.body.appendChild(a);

    const e = click(a);
    expect(e.defaultPrevented).toBe(false);
  });

  it("skips external links (different origin)", () => {
    const { document } = createEnv("http://localhost/");
    const router = createMockRouter();
    cleanup = setupLinkInterception(router);

    const a = document.createElement("a");
    a.href = "https://github.com/octocat";
    document.body.appendChild(a);

    const e = click(a);
    expect(e.defaultPrevented).toBe(false);
  });
});
