/* tests/e2e/fixture/src/client/main.tsx */

import type { ComponentType } from "react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { SeamDataProvider, parseSeamData } from "@canmi/seam-react";
import { HomeSkeleton } from "./pages/home-skeleton.js";
import { React19Skeleton } from "./pages/react19-skeleton.js";
import { FormSkeleton } from "./pages/form-skeleton.js";
import { ErrorSkeleton } from "./pages/error-skeleton.js";
import { AsyncSkeleton } from "./pages/async-skeleton.js";

const routeMap: Record<string, ComponentType> = {
  "/": HomeSkeleton,
  "/react19": React19Skeleton,
  "/form": FormSkeleton,
  "/error": ErrorSkeleton,
  "/async": AsyncSkeleton,
};

const seamRoot = document.getElementById("__SEAM_ROOT__");

if (seamRoot) {
  const Component = routeMap[window.location.pathname];
  if (Component) {
    const raw = parseSeamData();
    const data = (raw as Record<string, unknown>).page ?? raw;
    hydrateRoot(
      seamRoot,
      <StrictMode>
        <SeamDataProvider value={data}>
          <Component />
        </SeamDataProvider>
      </StrictMode>,
    );
  }
}
