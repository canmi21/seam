/* packages/server/core/typescript/src/resolve.ts */

export interface ResolveContext {
  pathLocale: string | null;
  cookie?: string;
  acceptLanguage?: string;
  locales: string[];
  defaultLocale: string;
}

export type ResolveLocaleFn = (ctx: ResolveContext) => string;

/** Default resolve chain: pathLocale -> cookie("seam-locale") -> Accept-Language -> defaultLocale */
export function defaultResolve(ctx: ResolveContext): string {
  if (ctx.pathLocale) return ctx.pathLocale;

  const localeSet = new Set(ctx.locales);

  const fromCookie = parseCookieLocale(ctx.cookie, "seam-locale", localeSet);
  if (fromCookie) return fromCookie;

  const fromHeader = parseAcceptLanguage(ctx.acceptLanguage, localeSet);
  if (fromHeader) return fromHeader;

  return ctx.defaultLocale;
}

function parseCookieLocale(
  header: string | undefined,
  name: string,
  localeSet: Set<string>,
): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const [k, v] = pair.trim().split("=");
    if (k === name && v && localeSet.has(v)) return v;
  }
  return null;
}

function parseAcceptLanguage(header: string | undefined, localeSet: Set<string>): string | null {
  if (!header) return null;
  const entries: { lang: string; q: number }[] = [];
  for (const part of header.split(",")) {
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
  for (const { lang } of entries) {
    if (localeSet.has(lang)) return lang;
    // Prefix match: zh-CN -> zh
    const prefix = lang.split("-")[0];
    if (prefix !== lang && localeSet.has(prefix)) return prefix;
  }
  return null;
}
