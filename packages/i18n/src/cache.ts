/* packages/i18n/src/cache.ts */

/** Content hash router table: routeHash → { locale → contentHash (4 hex) } */
export type HashRouter = Record<string, Record<string, string>>;

export interface CachedEntry {
  hash: string;
  messages: Record<string, string>;
}

export interface I18nCache {
  get(locale: string, routeHash: string): CachedEntry | null;
  set(locale: string, routeHash: string, hash: string, messages: Record<string, string>): void;
  /** Validate against content hash router: evict stale or unknown entries */
  validate(router: HashRouter): void;
}

const DEFAULT_PREFIX = "seam-i18n:";

/** Build a localStorage key from locale + route hash */
function cacheKey(prefix: string, locale: string, routeHash: string): string {
  return `${prefix}${locale}:${routeHash}`;
}

/**
 * Create a localStorage-backed i18n cache.
 * Entries are keyed by `{prefix}{locale}:{routeHash}` and store `{hash, messages}`.
 */
export function createI18nCache(prefix?: string): I18nCache {
  const p = prefix ?? DEFAULT_PREFIX;
  const storage = typeof window !== "undefined" ? window.localStorage : null;

  return {
    get(locale, routeHash) {
      if (!storage) return null;
      try {
        const raw = storage.getItem(cacheKey(p, locale, routeHash));
        if (!raw) return null;
        return JSON.parse(raw) as CachedEntry;
      } catch {
        return null;
      }
    },

    set(locale, routeHash, hash, messages) {
      if (!storage) return;
      try {
        storage.setItem(cacheKey(p, locale, routeHash), JSON.stringify({ hash, messages }));
      } catch {
        // Storage full or restricted — silently skip
      }
    },

    validate(router) {
      if (!storage) return;
      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(p)) continue;
        const rest = key.slice(p.length);
        const sep = rest.indexOf(":");
        if (sep < 0) {
          keysToRemove.push(key);
          continue;
        }
        const locale = rest.slice(0, sep);
        const rHash = rest.slice(sep + 1);

        // Route hash not in router → stale
        const localeHashes = router[rHash];
        if (!localeHashes) {
          keysToRemove.push(key);
          continue;
        }

        // Content hash mismatch → stale
        const expectedHash = localeHashes[locale];
        if (!expectedHash) {
          keysToRemove.push(key);
          continue;
        }

        try {
          const entry = JSON.parse(storage.getItem(key)!) as CachedEntry;
          if (entry.hash !== expectedHash) {
            keysToRemove.push(key);
          }
        } catch {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        storage.removeItem(key);
      }
    },
  };
}
