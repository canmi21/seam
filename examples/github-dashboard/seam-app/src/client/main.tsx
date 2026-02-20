/* examples/github-dashboard/seam-app/src/client/main.tsx */

import "./index.css";
import type { ComponentType } from "react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { SeamDataProvider, parseSeamData } from "@canmi/seam-react";
import { HomeSkeleton } from "./pages/home-skeleton.js";
import { DashboardSkeleton } from "./pages/dashboard-skeleton.js";

const routeMap: Record<string, ComponentType> = {
  "/": HomeSkeleton,
  "/dashboard/:username": DashboardSkeleton,
};

const seamRoot = document.getElementById("__SEAM_ROOT__");

if (seamRoot) {
  const pathname = window.location.pathname;
  let Component: ComponentType | undefined;

  if (routeMap[pathname]) {
    Component = routeMap[pathname];
  } else if (pathname.startsWith("/dashboard/")) {
    Component = routeMap["/dashboard/:username"];
  }

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
