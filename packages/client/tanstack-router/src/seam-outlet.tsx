/* packages/client/tanstack-router/src/seam-outlet.tsx */

import { useContext } from "react";
import type { ComponentType, ReactNode } from "react";
import { Match, matchContext, useRouter, useRouterState } from "@tanstack/react-router";

/**
 * Drop-in replacement for TanStack Router's Outlet that skips the
 * <Suspense> wrapper on root routes.  The standard Outlet always wraps
 * root-route children in <Suspense>, which injects <!--$-->…<!--/$-->
 * comment markers into the DOM.  CTR-rendered HTML doesn't contain
 * those markers, so hydration fails with a mismatch.
 */
export function SeamOutlet() {
  const router = useRouter();
  const matchId = useContext(matchContext);
  const childMatchId = useRouterState({
    select: (s) => {
      const matches = s.matches;
      const idx = matches.findIndex((d) => d.id === matchId);
      return matches[idx + 1]?.id;
    },
  });

  if (!childMatchId) return null;
  return <Match matchId={childMatchId} />;
}

/** Wrap a layout component so it receives <SeamOutlet /> as children */
export function createLayoutWrapper(Layout: ComponentType<{ children: ReactNode }>) {
  return function LayoutWrapper() {
    return (
      <Layout>
        <SeamOutlet />
      </Layout>
    );
  };
}
