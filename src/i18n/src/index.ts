/* src/i18n/src/index.ts */

export interface I18nInstance {
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export interface SwitchLocaleOptions {
  /** Full-page reload (default: true). When false, uses SPA mode via RPC. */
  reload?: boolean;
  /** Current route's hash (required for SPA mode to fetch messages) */
  routeHash?: string;
  /** RPC function to call __seam_i18n_query (required for SPA mode) */
  rpc?: (procedure: string, input: unknown) => Promise<unknown>;
  /** Callback to update i18n state with fetched messages (required for SPA mode) */
  onMessages?: (locale: string, messages: Record<string, string>, hash?: string) => void;
  /** Write cookie before switching. True uses defaults; CookieOptions for custom. */
  writeCookie?: boolean | { name?: string; path?: string; maxAge?: number; sameSite?: string };
}

/** Interpolate `{name}` placeholders in a message string */
function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const val = params[name];
    return val !== undefined ? String(val) : `{${name}}`;
  });
}

/**
 * Create an i18n instance with locale-specific messages.
 * Lookup: messages[key] -> key itself.
 * Server pre-merges default locale messages, so no client-side fallback needed.
 */
export function createI18n(locale: string, messages: Record<string, string>): I18nInstance {
  return {
    locale,
    t(key: string, params?: Record<string, string | number>): string {
      const raw = messages[key] ?? key;
      return params ? interpolate(raw, params) : raw;
    },
  };
}

/**
 * Switch to a different locale.
 * Reload mode (default): writes cookie + redirects.
 * SPA mode: calls RPC for new messages, invokes onMessages callback.
 */
export async function switchLocale(locale: string, opts?: SwitchLocaleOptions): Promise<void> {
  // Write cookie if requested
  if (opts?.writeCookie !== false && opts?.writeCookie !== undefined) {
    const cookieOpts = typeof opts.writeCookie === "object" ? opts.writeCookie : undefined;
    const name = cookieOpts?.name ?? "seam-locale";
    const path = cookieOpts?.path ?? "/";
    const maxAge = cookieOpts?.maxAge ?? 365 * 24 * 60 * 60;
    const sameSite = cookieOpts?.sameSite ?? "lax";
    if (typeof document !== "undefined") {
      document.cookie = `${name}=${locale};path=${path};max-age=${maxAge};samesite=${sameSite}`;
    }
  }

  // Reload mode: navigate to current URL (server will pick up cookie)
  const reload = opts?.reload ?? true;
  if (reload) {
    if (typeof window !== "undefined") window.location.reload();
    return;
  }

  // SPA mode: fetch messages via RPC
  if (!opts?.rpc || !opts.routeHash || !opts.onMessages) return;
  const result = (await opts.rpc("__seam_i18n_query", {
    route: opts.routeHash,
    locale,
  })) as { hash?: string; messages: Record<string, string> };
  opts.onMessages(locale, result.messages, result.hash);
}

/**
 * Remove the locale query parameter from the URL bar after hydration.
 * Only deletes the specified param; preserves all other query params.
 * Uses replaceState to avoid creating a navigation history entry.
 */
export function cleanLocaleQuery(param = "lang"): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(param)) return;
  url.searchParams.delete(param);
  const newUrl = url.pathname + (url.search || "") + url.hash;
  window.history.replaceState(window.history.state, "", newUrl);
}

/** Return a new object with keys sorted alphabetically */
export function sortMessages(messages: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(messages).sort()) {
    sorted[key] = messages[key];
  }
  return sorted;
}
