/* packages/client/tanstack-router/src/seam-data-bridge.tsx */

import { useMatches } from "@tanstack/react-router";
import { SeamDataProvider } from "@canmi/seam-react";
import type { ReactNode } from "react";

/**
 * InnerWrap component that bridges TanStack Router's loaderData to SeamDataProvider.
 * Uses useMatches() to read from router.__store (works in InnerWrap context).
 */
export function SeamDataBridge({ children }: { children: ReactNode }) {
  const matches = useMatches();
  const leafMatch = matches[matches.length - 1];
  const loaderData = leafMatch?.loaderData as Record<string, unknown> | undefined;

  // Replicate the unwrapping from main.tsx: single "page" loader gets unwrapped
  const seamData = loaderData ? (loaderData.page ?? loaderData) : {};

  return <SeamDataProvider value={seamData}>{children}</SeamDataProvider>;
}
