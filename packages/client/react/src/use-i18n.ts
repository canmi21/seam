/* packages/client/react/src/use-i18n.ts */

import { createContext, useContext } from "react";

interface I18nContextValue {
  locale: string;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider = I18nContext.Provider;

export function useT(): (key: string) => string {
  const ctx = useContext(I18nContext);
  if (!ctx) return (key) => key;
  return ctx.t;
}

export function useLocale(): string {
  const ctx = useContext(I18nContext);
  return ctx?.locale ?? "origin";
}
