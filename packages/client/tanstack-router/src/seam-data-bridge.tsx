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
  const leafMatch = matches[matches.length - 1];
  const loaderData = leafMatch?.loaderData as Record<string, unknown> | undefined;

  // Replicate the unwrapping from main.tsx: single "page" loader gets unwrapped
  const seamData = loaderData ? (loaderData.page ?? loaderData) : {};

  const router = useRouter();
  const navigate = useCallback((url: string) => router.navigate({ to: url }), [router]);

  return (
    <SeamNavigateProvider value={navigate}>
      <SeamDataProvider value={seamData}>{children}</SeamDataProvider>
    </SeamNavigateProvider>
  );
}
