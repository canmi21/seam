/* packages/client/tanstack-router/src/seam-data-bridge.tsx */

import { useMatches, useRouter } from "@tanstack/react-router";
import { I18nProvider, SeamDataProvider, SeamNavigateProvider } from "@canmi/seam-react";
import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";

// Read i18n context from __seam_i18n script tag embedded by the build pipeline.
// Returns { locale, t } matching what I18nProvider expects, or null if absent.
function readI18nContext(): { locale: string; t: (key: string) => string } | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById("__seam_i18n");
  if (!el?.textContent) return null;
  try {
    const { locale, messages } = JSON.parse(el.textContent) as {
      locale: string;
      messages: Record<string, string>;
    };
    return { locale, t: (key: string) => messages[key] ?? key };
  } catch {
    return null;
  }
}

/**
 * InnerWrap component that bridges TanStack Router's loaderData to SeamDataProvider
 * and provides SPA navigation via SeamNavigateProvider.
 * When i18n messages are embedded in the page, also provides I18nProvider so that
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
  const seamData = merged.page ?? merged;

  const router = useRouter();
  const navigate = useCallback(
    (url: string): void => {
      void router.navigate({ to: url });
    },
    [router],
  );

  const i18n = useMemo(readI18nContext, []);

  let content = <SeamDataProvider value={seamData}>{children}</SeamDataProvider>;
  if (i18n) {
    content = <I18nProvider value={i18n}>{content}</I18nProvider>;
  }

  return <SeamNavigateProvider value={navigate}>{content}</SeamNavigateProvider>;
}
