/* packages/i18n/src/react.ts */

import { createContext, useContext } from "react";
import type { I18nInstance } from "./index.js";

const I18nContext = createContext<I18nInstance | null>(null);
export const I18nProvider = I18nContext.Provider;

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const ctx = useContext(I18nContext);
  if (!ctx) return (key) => key;
  return ctx.t;
}

export function useLocale(): string {
  const ctx = useContext(I18nContext);
  return ctx?.locale ?? "en";
}
