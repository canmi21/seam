/* src/client/tanstack-router/src/seam-core-bridge.tsx */

import { useMatches, useRouter } from "@tanstack/react-router";
import { SeamDataProvider, SeamNavigateProvider } from "@canmi/seam-react";
import { useCallback } from "react";
import type { ReactNode } from "react";

/** Merge loaderData from all matched routes (layout + page levels) */
function mergeLoaderData(matches: { loaderData?: unknown }[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const match of matches) {
    const ld = match.loaderData as Record<string, unknown> | undefined;
    if (ld && typeof ld === "object") Object.assign(merged, ld);
  }
  return (merged.page ?? merged) as Record<string, unknown>;
}

/**
 * Minimal bridge — data merging + SPA navigation only.
 * No i18n imports or logic. Used as default when no i18nBridge is provided.
 */
export function SeamCoreBridge({ children }: { children: ReactNode }) {
  const matches = useMatches();
  const seamData = mergeLoaderData(matches);

  const router = useRouter();
  const navigate = useCallback(
    (url: string): void => {
      void router.navigate({ to: url });
    },
    [router],
  );

  return (
    <SeamNavigateProvider value={navigate}>
      <SeamDataProvider value={seamData}>{children}</SeamDataProvider>
    </SeamNavigateProvider>
  );
}
