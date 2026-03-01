/* src/client/tanstack-router/src/seam-outlet.tsx */

import type { ComponentType, ReactNode } from "react";
import { Match, useLoaderData, useMatch, useRouterState } from "@tanstack/react-router";
import { SeamDataProvider } from "@canmi/seam-react";

/**
 * Drop-in replacement for TanStack Router's Outlet that skips the
 * <Suspense> wrapper on root routes.  The standard Outlet always wraps
 * root-route children in <Suspense>, which injects <!--$-->…<!--/$-->
 * comment markers into the DOM.  CTR-rendered HTML doesn't contain
 * those markers, so hydration fails with a mismatch.
 */
export function SeamOutlet() {
  const matchId = useMatch({ strict: false, select: (m) => m.id });
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

/**
 * Wrap a layout component so it receives <SeamOutlet /> as children.
 * When the layout has loaders, wrap with SeamDataProvider so useSeamData()
 * returns layout-scoped data within the layout component.
 */
export function createLayoutWrapper(
  Layout: ComponentType<{ children: ReactNode }>,
  hasLoaders?: boolean,
) {
  if (hasLoaders) {
    return function LayoutWrapperWithData() {
      const data: unknown = useLoaderData({ strict: false });
      return (
        <SeamDataProvider value={data}>
          <Layout>
            <SeamOutlet />
          </Layout>
        </SeamDataProvider>
      );
    };
  }

  return function LayoutWrapper() {
    return (
      <Layout>
        <SeamOutlet />
      </Layout>
    );
  };
}

/** Wrap a page component with SeamDataProvider so useSeamData() returns page-scoped data */
export function createPageWrapper(Page: ComponentType) {
  return function PageWrapper() {
    const data: unknown = useLoaderData({ strict: false });
    return (
      <SeamDataProvider value={data}>
        <Page />
      </SeamDataProvider>
    );
  };
}
