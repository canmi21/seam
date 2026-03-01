/* src/i18n/src/react.ts */

import { createContext, useCallback, useContext } from "react";
import type { I18nInstance, SwitchLocaleOptions } from "./index.js";
import { switchLocale } from "./index.js";

const I18nContext = createContext<I18nInstance | null>(null);
export const I18nProvider = I18nContext.Provider;

/** Context for switchLocale wiring: RPC function + route hash + state updater */
export interface SwitchLocaleContext {
  rpc: (procedure: string, input: unknown) => Promise<unknown>;
  routeHash: string;
  onMessages: (locale: string, messages: Record<string, string>, hash?: string) => void;
}

const SwitchLocaleCtx = createContext<SwitchLocaleContext | null>(null);
export const SwitchLocaleProvider = SwitchLocaleCtx.Provider;

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const ctx = useContext(I18nContext);
  if (!ctx) return (key) => key;
  return ctx.t;
}

export function useLocale(): string {
  const ctx = useContext(I18nContext);
  return ctx?.locale ?? "en";
}

/**
 * Hook that returns a function to switch the active locale.
 * In SPA mode (reload: false), uses the SwitchLocaleProvider context for RPC + state update.
 * In reload mode (default), simply writes cookie and reloads.
 */
export function useSwitchLocale(): (locale: string, opts?: SwitchLocaleOptions) => Promise<void> {
  const switchCtx = useContext(SwitchLocaleCtx);
  return useCallback(
    (locale: string, opts?: SwitchLocaleOptions) => {
      const merged: SwitchLocaleOptions = { ...opts };
      // Wire SPA mode from context when available and reload not explicitly requested
      if (switchCtx && merged.reload === false) {
        merged.rpc ??= switchCtx.rpc;
        merged.routeHash ??= switchCtx.routeHash;
        merged.onMessages ??= switchCtx.onMessages;
      }
      return switchLocale(locale, merged);
    },
    [switchCtx],
  );
}
