/* src/i18n/src/storage.ts */

export interface CookieOptions {
  name?: string;
  path?: string;
  maxAge?: number;
  sameSite?: string;
}

export interface StorageOptions {
  key?: string;
}

const DEFAULT_COOKIE = "seam-locale";
const DEFAULT_KEY = "seam-locale";
const ONE_YEAR = 365 * 24 * 60 * 60;

function dispatchChange(locale: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("seam-locale-change", { detail: locale }));
  }
}

export function writeCookie(locale: string, options?: CookieOptions): void {
  if (typeof document === "undefined") return;
  const name = options?.name ?? DEFAULT_COOKIE;
  const path = options?.path ?? "/";
  const maxAge = options?.maxAge ?? ONE_YEAR;
  const sameSite = options?.sameSite ?? "lax";
  document.cookie = `${name}=${locale};path=${path};max-age=${maxAge};samesite=${sameSite}`;
  dispatchChange(locale);
}

export function readCookie(options?: CookieOptions): string | null {
  if (typeof document === "undefined") return null;
  const name = options?.name ?? DEFAULT_COOKIE;
  for (const pair of document.cookie.split(";")) {
    const [k, v] = pair.trim().split("=");
    if (k === name && v) return v;
  }
  return null;
}

export function writeLocalStorage(locale: string, options?: StorageOptions): void {
  if (typeof window === "undefined") return;
  const key = options?.key ?? DEFAULT_KEY;
  window.localStorage.setItem(key, locale);
  dispatchChange(locale);
}

export function readLocalStorage(options?: StorageOptions): string | null {
  if (typeof window === "undefined") return null;
  const key = options?.key ?? DEFAULT_KEY;
  return window.localStorage.getItem(key);
}

export function onLocaleChange(callback: (locale: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    callback((e as CustomEvent<string>).detail);
  };
  window.addEventListener("seam-locale-change", handler);
  return () => window.removeEventListener("seam-locale-change", handler);
}
