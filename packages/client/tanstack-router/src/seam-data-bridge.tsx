/* packages/client/tanstack-router/src/seam-data-bridge.tsx */

import { useMatches, useRouter } from "@tanstack/react-router";
import { SeamDataProvider, SeamNavigateProvider } from "@canmi/seam-react";
import { I18nProvider } from "@canmi/seam-i18n/react";
import { createI18n } from "@canmi/seam-i18n";
import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type { I18nInstance } from "@canmi/seam-i18n";
import type { SeamRouterContext } from "./types.js";

interface I18nRaw {
  locale: string;
  messages: Record<string, string>;
  fallbackMessages?: Record<string, string>;
}

// Build I18nInstance from raw data stored in router context or DOM fallback.
function readI18nContext(raw: unknown): I18nInstance | null {
  const data = raw as I18nRaw | null | undefined;
  if (data?.locale) {
    return createI18n(data.locale, data.messages ?? {}, data.fallbackMessages);
  }

  // Fallback: <script id="__seam_i18n"> embedded by build pipeline (deprecated path)
  if (typeof document === "undefined") return null;
  const el = document.getElementById("__seam_i18n");
  if (!el?.textContent) return null;
  try {
    const { locale, messages } = JSON.parse(el.textContent) as {
      locale: string;
      messages: Record<string, string>;
    };
    return createI18n(locale, messages);
  } catch {
    return null;
  }
}

/**
 * InnerWrap component that bridges TanStack Router's loaderData to SeamDataProvider
 * and provides SPA navigation via SeamNavigateProvider.
 * When i18n messages are available, also provides I18nProvider so that
 * useT() returns translated strings matching the server-rendered HTML.
 */
export function SeamDataBridge({ children }: { children: ReactNode }) {
  const matches = useMatches();

  // Merge loaderData from all matched routes (layout + page levels)
  const merged: Record<string, unknown> = {};
  for (const match of matches) {
    const ld = match.loaderData as Record<string, unknown> | undefined;
    if (ld && typeof ld === "object") {
      Object.assign(merged, ld);
    }
  }
  const seamData = (merged.page ?? merged) as Record<string, unknown>;

  const router = useRouter();
  const navigate = useCallback(
    (url: string): void => {
      void router.navigate({ to: url });
    },
    [router],
  );

  const rawI18n = (router.options.context as SeamRouterContext)?._seamI18n;
  const i18n = useMemo(() => readI18nContext(rawI18n), [rawI18n]);

  let content = <SeamDataProvider value={seamData}>{children}</SeamDataProvider>;
  if (i18n) {
    content = <I18nProvider value={i18n}>{content}</I18nProvider>;
  }

  return <SeamNavigateProvider value={navigate}>{content}</SeamNavigateProvider>;
}
