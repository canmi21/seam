/* packages/i18n/__tests__/storage.test.ts */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  writeCookie,
  readCookie,
  writeLocalStorage,
  readLocalStorage,
  onLocaleChange,
} from "../src/storage.js";

// Mock browser globals since jsdom is not available in this project
let cookieStore: string;

beforeEach(() => {
  cookieStore = "";

  // Mock document.cookie
  Object.defineProperty(globalThis, "document", {
    value: {
      get cookie() {
        return cookieStore;
      },
      set cookie(val: string) {
        // Simplified cookie parser: extract name=value, ignore directives
        const [pair] = val.split(";");
        const [name, value] = pair.split("=");
        if (!value || value === "") {
          // Remove cookie
          const pairs = cookieStore
            .split(";")
            .map((p) => p.trim())
            .filter((p) => !p.startsWith(name + "="));
          cookieStore = pairs.join("; ");
        } else {
          // Add/replace cookie
          const pairs = cookieStore
            .split(";")
            .map((p) => p.trim())
            .filter((p) => p && !p.startsWith(name + "="));
          pairs.push(`${name}=${value}`);
          cookieStore = pairs.join("; ");
        }
      },
    },
    writable: true,
    configurable: true,
  });

  // Mock localStorage
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
    writable: true,
    configurable: true,
  });

  // Mock window (for events)
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    value: {
      addEventListener: (type: string, handler: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(handler);
      },
      removeEventListener: (type: string, handler: EventListener) => {
        listeners.get(type)?.delete(handler);
      },
      dispatchEvent: (event: Event) => {
        const handlers = listeners.get(event.type);
        if (handlers) {
          for (const h of handlers) h(event);
        }
      },
      localStorage: globalThis.localStorage,
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  // Clean up globals
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).window;
});

describe("cookie storage", () => {
  it("writeCookie sets and readCookie reads", () => {
    writeCookie("zh");
    expect(readCookie()).toBe("zh");
  });

  it("custom cookie name", () => {
    writeCookie("zh", { name: "my-lang" });
    expect(readCookie({ name: "my-lang" })).toBe("zh");
    expect(readCookie()).toBeNull();
  });

  it("readCookie returns null when not set", () => {
    expect(readCookie()).toBeNull();
  });
});

describe("localStorage storage", () => {
  it("writeLocalStorage sets and readLocalStorage reads", () => {
    writeLocalStorage("zh");
    expect(readLocalStorage()).toBe("zh");
    expect(globalThis.localStorage.getItem("seam-locale")).toBe("zh");
  });

  it("custom key", () => {
    writeLocalStorage("ja", { key: "app-lang" });
    expect(readLocalStorage({ key: "app-lang" })).toBe("ja");
    expect(readLocalStorage()).toBeNull();
  });

  it("readLocalStorage returns null when not set", () => {
    expect(readLocalStorage()).toBeNull();
  });
});

describe("onLocaleChange", () => {
  it("fires callback on writeCookie", () => {
    const cb = vi.fn();
    const unsub = onLocaleChange(cb);
    writeCookie("zh");
    expect(cb).toHaveBeenCalledWith("zh");
    unsub();
  });

  it("fires callback on writeLocalStorage", () => {
    const cb = vi.fn();
    const unsub = onLocaleChange(cb);
    writeLocalStorage("ja");
    expect(cb).toHaveBeenCalledWith("ja");
    unsub();
  });

  it("unsubscribe stops callbacks", () => {
    const cb = vi.fn();
    const unsub = onLocaleChange(cb);
    unsub();
    writeCookie("zh");
    expect(cb).not.toHaveBeenCalled();
  });
});
