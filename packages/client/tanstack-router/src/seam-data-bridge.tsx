/* packages/client/tanstack-router/src/seam-data-bridge.tsx */

import { useMatches, useRouter } from "@tanstack/react-router";
import { SeamDataProvider, SeamNavigateProvider } from "@canmi/seam-react";
import { useCallback } from "react";
import type { ReactNode } from "react";

/**
 * InnerWrap component that bridges TanStack Router's loaderData to SeamDataProvider
 * and provides SPA navigation via SeamNavigateProvider.
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

  return (
    <SeamNavigateProvider value={navigate}>
      <SeamDataProvider value={seamData}>{children}</SeamDataProvider>
    </SeamNavigateProvider>
  );
}
