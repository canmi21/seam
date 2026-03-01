/* src/client/tanstack-router/src/link-interceptor.ts */

import type { AnyRouter } from "@tanstack/react-router";

/**
 * Attach a document-level click listener that intercepts same-origin `<a>` clicks
 * and routes them through TanStack Router for SPA navigation.
 *
 * Guard logic mirrors TanStack Router's `useLinkProps` click handler so that
 * modifier-clicks, external links, downloads, etc. fall through to the browser.
 */
export function setupLinkInterception(router: AnyRouter): () => void {
  function handler(e: MouseEvent) {
    // Only left-click
    if (e.button !== 0) return;
    // Skip modifier keys (new tab, download, etc.)
    if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
    // Already handled
    if (e.defaultPrevented) return;

    const anchor = (e.target as Element)?.closest?.("a");
    if (!anchor) return;

    // Explicit opt-out
    if (anchor.closest("[data-seam-no-intercept]")) return;
    // target="_blank" etc.
    const target = anchor.getAttribute("target");
    if (target && target !== "_self") return;
    // Download links
    if (anchor.hasAttribute("download")) return;
    // Non-HTTP protocols (mailto:, tel:, etc.)
    if (anchor.protocol !== "http:" && anchor.protocol !== "https:") return;
    // External links
    if (anchor.origin !== location.origin) return;
    // Same-page hash navigation
    if (anchor.href === location.href && anchor.hash) return;

    e.preventDefault();
    // Strip basepath prefix so TanStack Router resolves the route correctly
    let pathname = anchor.pathname;
    const basepath = router.basepath;
    if (basepath && basepath !== "/" && pathname.startsWith(basepath)) {
      pathname = pathname.slice(basepath.length) || "/";
    }
    void router.navigate({ to: pathname + anchor.search + anchor.hash });
  }

  document.addEventListener("click", handler);
  return () => document.removeEventListener("click", handler);
}
