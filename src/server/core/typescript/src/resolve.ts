/* src/server/core/typescript/src/resolve.ts */

// -- New strategy-based API --

export interface ResolveStrategy {
  readonly kind: string;
  resolve(data: ResolveData): string | null;
}

export interface ResolveData {
  readonly url: string;
  readonly pathLocale: string | null;
  readonly cookie: string | undefined;
  readonly acceptLanguage: string | undefined;
  readonly locales: string[];
  readonly defaultLocale: string;
}

/** URL prefix strategy: trusts pathLocale if it is a known locale */
export function fromUrlPrefix(): ResolveStrategy {
  return {
    kind: "url_prefix",
    resolve(data) {
      if (data.pathLocale && data.locales.includes(data.pathLocale)) {
        return data.pathLocale;
      }
      return null;
    },
  };
}

/** Cookie strategy: reads a named cookie and validates against known locales */
export function fromCookie(name = "seam-locale"): ResolveStrategy {
  return {
    kind: "cookie",
    resolve(data) {
      if (!data.cookie) return null;
      for (const pair of data.cookie.split(";")) {
        const [k, v] = pair.trim().split("=");
        if (k === name && v && data.locales.includes(v)) return v;
      }
      return null;
    },
  };
}

/** Accept-Language strategy: parses header with q-value sorting + prefix match */
export function fromAcceptLanguage(): ResolveStrategy {
  return {
    kind: "accept_language",
    resolve(data) {
      if (!data.acceptLanguage) return null;
      const entries: { lang: string; q: number }[] = [];
      for (const part of data.acceptLanguage.split(",")) {
        const trimmed = part.trim();
        const [lang, ...rest] = trimmed.split(";");
        let q = 1;
        for (const r of rest) {
          const match = r.trim().match(/^q=(\d+(?:\.\d+)?)$/);
          if (match) q = parseFloat(match[1]);
        }
        entries.push({ lang: lang.trim(), q });
      }
      entries.sort((a, b) => b.q - a.q);
      const localeSet = new Set(data.locales);
      for (const { lang } of entries) {
        if (localeSet.has(lang)) return lang;
        // Prefix match: zh-CN -> zh
        const prefix = lang.split("-")[0];
        if (prefix !== lang && localeSet.has(prefix)) return prefix;
      }
      return null;
    },
  };
}

/** URL query strategy: reads a query parameter and validates against known locales */
export function fromUrlQuery(param = "lang"): ResolveStrategy {
  return {
    kind: "url_query",
    resolve(data) {
      if (!data.url) return null;
      try {
        const url = new URL(data.url, "http://localhost");
        const value = url.searchParams.get(param);
        if (value && data.locales.includes(value)) return value;
      } catch {
        // Invalid URL — skip
      }
      return null;
    },
  };
}

/** Run strategies in order; first non-null wins, otherwise defaultLocale */
export function resolveChain(strategies: ResolveStrategy[], data: ResolveData): string {
  for (const s of strategies) {
    const result = s.resolve(data);
    if (result !== null) return result;
  }
  return data.defaultLocale;
}

/** Default strategy chain: url_prefix -> cookie -> accept_language */
export function defaultStrategies(): ResolveStrategy[] {
  return [fromUrlPrefix(), fromCookie(), fromAcceptLanguage()];
}
