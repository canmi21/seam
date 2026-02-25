/* packages/client/tanstack-router/src/seam-data-bridge.tsx */

import { useMatches, useRouter } from "@tanstack/react-router";
import { I18nProvider, SeamDataProvider, SeamNavigateProvider } from "@canmi/seam-react";
import { createI18n } from "@canmi/seam-i18n";
import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type { I18nInstance } from "@canmi/seam-i18n";

// Read i18n context from two sources (new runtime-injected path first, old build-time fallback second).
// Returns I18nInstance or null if absent.
function readI18nContext(seamData: Record<string, unknown>): I18nInstance | null {
  // New path: _i18n injected by server runtime into __SEAM_DATA__
  const i18nData = seamData._i18n as
    | {
        locale: string;
        messages: Record<string, string>;
        fallbackMessages?: Record<string, string>;
      }
    | undefined;
  if (i18nData?.locale) {
    return createI18n(i18nData.locale, i18nData.messages ?? {}, i18nData.fallbackMessages);
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

  const i18n = useMemo(() => readI18nContext(seamData), [seamData]);

  let content = <SeamDataProvider value={seamData}>{children}</SeamDataProvider>;
  if (i18n) {
    content = <I18nProvider value={i18n}>{content}</I18nProvider>;
  }

  return <SeamNavigateProvider value={navigate}>{content}</SeamNavigateProvider>;
}
