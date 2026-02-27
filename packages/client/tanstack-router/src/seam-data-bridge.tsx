/* packages/client/tanstack-router/src/seam-data-bridge.tsx */

import { useMatches, useRouter } from "@tanstack/react-router";
import { SeamDataProvider, SeamNavigateProvider } from "@canmi/seam-react";
import { I18nProvider, SwitchLocaleProvider } from "@canmi/seam-i18n/react";
import { createI18n, cleanLocaleQuery } from "@canmi/seam-i18n";
import { routeHash } from "@canmi/seam-i18n/hash";
import { createI18nCache } from "@canmi/seam-i18n/cache";
import type { I18nCache } from "@canmi/seam-i18n/cache";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { I18nInstance } from "@canmi/seam-i18n";
import type { SeamRouterContext } from "./types.js";
import { matchSeamRoute } from "./route-matcher.js";

/** Build I18nInstance from raw metadata (initial load or fetched) */
function buildI18n(locale: string, messages: Record<string, string>): I18nInstance {
  return createI18n(locale, messages);
}

/** Resolve current seam route pattern from the URL pathname */
function resolveRoutePattern(leafPaths: string[] | undefined, pathname: string): string | null {
  if (!leafPaths?.length) return null;
  const match = matchSeamRoute(leafPaths, pathname);
  return match?.path ?? null;
}

// Singleton cache (created once when router data is present)
let globalCache: I18nCache | null = null;

/**
 * InnerWrap component that bridges TanStack Router's loaderData to SeamDataProvider
 * and provides SPA navigation via SeamNavigateProvider.
 * Manages i18n state: initial load from __SEAM_DATA__, SPA updates via RPC + cache.
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

  const ctx = router.options.context as SeamRouterContext;
  const i18nMeta = ctx._seamI18n;
  const leafPaths = ctx._seamLeafPaths;

  // Strip locale query param from URL on initial hydration (hidden mode UX)
  const cleanParam = ctx._cleanLocaleQuery;
  useEffect(() => {
    if (cleanParam) cleanLocaleQuery(cleanParam);
  }, [cleanParam]);

  // Initialize cache from router table (once)
  const cacheRef = useRef<I18nCache | null>(null);
  if (!cacheRef.current && i18nMeta?.router) {
    if (!globalCache) {
      globalCache = createI18nCache();
      globalCache.validate(i18nMeta.router);
    }
    cacheRef.current = globalCache;
  }

  // i18n state: locale + messages, can be updated on SPA nav or switchLocale
  const [i18nState, setI18nState] = useState<{
    locale: string;
    messages: Record<string, string>;
  } | null>(i18nMeta ? { locale: i18nMeta.locale, messages: i18nMeta.messages } : null);

  // Track the current route hash for SPA message loading
  const currentPathname = matches.length > 0 ? matches[matches.length - 1].pathname : "/";
  const currentPattern = useMemo(
    () => resolveRoutePattern(leafPaths, currentPathname),
    [leafPaths, currentPathname],
  );
  const currentRouteHash = useMemo(
    () => (currentPattern ? routeHash(currentPattern) : null),
    [currentPattern],
  );

  // Seed cache with initial messages
  const seeded = useRef(false);
  if (!seeded.current && i18nMeta && currentRouteHash && cacheRef.current) {
    if (i18nMeta.hash) {
      cacheRef.current.set(i18nMeta.locale, currentRouteHash, i18nMeta.hash, i18nMeta.messages);
    }
    seeded.current = true;
  }

  // On SPA navigation: fetch messages for new route when locale is active
  const prevPathnameRef = useRef(currentPathname);
  useEffect(() => {
    if (prevPathnameRef.current === currentPathname) return;
    prevPathnameRef.current = currentPathname;

    if (!i18nState || !currentRouteHash) return;
    const locale = i18nState.locale;
    const cache = cacheRef.current;

    // Try cache first
    if (cache) {
      const cached = cache.get(locale, currentRouteHash);
      if (cached) {
        setI18nState({ locale, messages: cached.messages });
        return;
      }
    }

    // Cache miss: fetch via RPC
    void ctx.seamRpc("__seam_i18n_query", { route: currentRouteHash, locale }).then((result) => {
      const { hash, messages } = result as { hash?: string; messages: Record<string, string> };
      if (cache && hash) cache.set(locale, currentRouteHash, hash, messages);
      setI18nState({ locale, messages });
    });
  }, [currentPathname, currentRouteHash, i18nState, ctx]);

  // Build I18nInstance from current state
  const i18n = useMemo(
    () => (i18nState ? buildI18n(i18nState.locale, i18nState.messages) : null),
    [i18nState],
  );

  // SwitchLocale callback for SPA mode
  const onMessages = useCallback(
    (locale: string, messages: Record<string, string>, hash?: string) => {
      setI18nState({ locale, messages });
      if (cacheRef.current && hash && currentRouteHash) {
        cacheRef.current.set(locale, currentRouteHash, hash, messages);
      }
    },
    [currentRouteHash],
  );

  let content = <SeamDataProvider value={seamData}>{children}</SeamDataProvider>;
  if (i18n) {
    const switchCtx = {
      rpc: ctx.seamRpc,
      routeHash: currentRouteHash ?? "",
      onMessages,
    };
    content = (
      <SwitchLocaleProvider value={switchCtx}>
        <I18nProvider value={i18n}>{content}</I18nProvider>
      </SwitchLocaleProvider>
    );
  }

  return <SeamNavigateProvider value={navigate}>{content}</SeamNavigateProvider>;
}
