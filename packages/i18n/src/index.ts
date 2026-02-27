/* packages/i18n/src/index.ts */

export interface I18nInstance {
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
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

/** Return a new object with keys sorted alphabetically */
export function sortMessages(messages: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(messages).sort()) {
    sorted[key] = messages[key];
  }
  return sorted;
}
