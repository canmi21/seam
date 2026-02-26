/* packages/client/react/scripts/skeleton/render.mjs */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SeamDataProvider } from "@canmi/seam-react";

let _I18nProvider = null;

export function setI18nProvider(provider) {
  _I18nProvider = provider;
}

class SeamBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeamBuildError";
  }
}

// Matches React-injected resource hint <link> tags.
// Only rel values used by React's resource APIs are targeted (preload, dns-prefetch, preconnect,
// data-precedence); user-authored <link> tags (canonical, alternate, stylesheet) are unaffected.
const RESOURCE_HINT_RE =
  /<link[^>]+rel\s*=\s*"(?:preload|dns-prefetch|preconnect)"[^>]*>|<link[^>]+data-precedence[^>]*>/gi;

function renderWithData(component, data, i18nValue) {
  const inner = createElement(SeamDataProvider, { value: data }, createElement(component));
  if (i18nValue && _I18nProvider) {
    return renderToString(createElement(_I18nProvider, { value: i18nValue }, inner));
  }
  return renderToString(inner);
}

function installRenderTraps(violations, teardowns) {
  function trapCall(obj, prop, label) {
    const orig = obj[prop];
    obj[prop] = function () {
      violations.push({ severity: "error", reason: `${label} called during skeleton render` });
      throw new SeamBuildError(`${label} is not allowed in skeleton components`);
    };
    teardowns.push(() => {
      obj[prop] = orig;
    });
  }

  trapCall(globalThis, "fetch", "fetch()");
  trapCall(Math, "random", "Math.random()");
  trapCall(Date, "now", "Date.now()");
  if (globalThis.crypto?.randomUUID) {
    trapCall(globalThis.crypto, "randomUUID", "crypto.randomUUID()");
  }

  // Timer APIs — these don't affect renderToString output, but pending handles
  // prevent the build process from exiting (Node keeps the event loop alive).
  trapCall(globalThis, "setTimeout", "setTimeout()");
  trapCall(globalThis, "setInterval", "setInterval()");
  if (globalThis.setImmediate) {
    trapCall(globalThis, "setImmediate", "setImmediate()");
  }
  trapCall(globalThis, "queueMicrotask", "queueMicrotask()");

  // Trap browser globals (only if not already defined — these are undefined in Node;
  // typeof checks bypass getters, so `typeof window !== 'undefined'` remains safe)
  for (const name of ["window", "document", "localStorage"]) {
    if (!(name in globalThis)) {
      Object.defineProperty(globalThis, name, {
        get() {
          violations.push({ severity: "error", reason: `${name} accessed during skeleton render` });
          throw new SeamBuildError(`${name} is not available in skeleton components`);
        },
        configurable: true,
      });
      teardowns.push(() => {
        delete globalThis[name];
      });
    }
  }
}

function validateOutput(html, violations) {
  if (html.includes("<!--$!-->")) {
    violations.push({
      severity: "error",
      reason:
        "Suspense abort detected \u2014 a component used an unresolved async resource\n" +
        "  (e.g. use(promise)) inside a <Suspense> boundary, producing an incomplete\n" +
        "  template with fallback content baked in.\n" +
        "  Fix: remove use() from skeleton components. Async data belongs in loaders.",
    });
  }

  const hints = Array.from(html.matchAll(RESOURCE_HINT_RE));
  if (hints.length > 0) {
    violations.push({
      severity: "warning",
      reason:
        `stripped ${hints.length} resource hint <link> tag(s) injected by React's preload()/preinit().\n` +
        "  These are not data-driven and would cause hydration mismatch.",
    });
  }
}

function stripResourceHints(html) {
  return html.replace(RESOURCE_HINT_RE, "");
}

/**
 * Render a component with full safety guards.
 * @param {string} routePath - route or layout identifier for error messages
 * @param {Function} component - React component to render
 * @param {object} data - sentinel or tracked data
 * @param {object|null} i18nValue - i18n context value
 * @param {{ buildWarnings: string[], seenWarnings: Set<string> }} ctx - shared warning state
 */
function guardedRender(routePath, component, data, i18nValue, ctx) {
  const violations = [];
  const teardowns = [];

  installRenderTraps(violations, teardowns);

  let html;
  try {
    html = renderWithData(component, data, i18nValue);
  } catch (e) {
    if (e instanceof SeamBuildError) {
      throw new SeamBuildError(
        `[seam] error: Skeleton rendering failed for route "${routePath}":\n` +
          `       ${e.message}\n\n` +
          "       Move browser API calls into useEffect() or event handlers.",
      );
    }
    throw e;
  } finally {
    for (const teardown of teardowns) teardown();
  }

  validateOutput(html, violations);

  const fatal = violations.filter((v) => v.severity === "error");
  if (fatal.length > 0) {
    const msg = fatal.map((v) => `[seam] error: ${routePath}\n  ${v.reason}`).join("\n\n");
    throw new SeamBuildError(msg);
  }

  // After fatal check, only warnings remain — dedup per message
  for (const v of violations) {
    const msg = `[seam] warning: ${routePath}\n  ${v.reason}`;
    if (!ctx.seenWarnings.has(msg)) {
      ctx.seenWarnings.add(msg);
      ctx.buildWarnings.push(msg);
    }
  }
  if (violations.length > 0) {
    html = stripResourceHints(html);
  }

  return html;
}

export { SeamBuildError, guardedRender, stripResourceHints, RESOURCE_HINT_RE };
