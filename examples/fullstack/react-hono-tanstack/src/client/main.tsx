/* examples/fullstack/react-hono-tanstack/src/client/main.tsx */

import type { ComponentType } from "react";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { SeamDataProvider, parseSeamData } from "@canmi/seam-react";
import { App } from "./app.js";
import { HomeSkeleton } from "./pages/home-skeleton.js";
import { AboutSkeleton } from "./pages/about-skeleton.js";
import { PostsSkeleton } from "./pages/posts-skeleton.js";
import { React19Skeleton } from "./pages/react19-skeleton.js";
import "./index.css";

const routeMap: Record<string, ComponentType> = {
  "/": HomeSkeleton,
  "/about": AboutSkeleton,
  "/posts": PostsSkeleton,
  "/react19": React19Skeleton,
};

const seamRoot = document.getElementById("__SEAM_ROOT__");
const devRoot = document.getElementById("root");

if (seamRoot) {
  const Component = routeMap[window.location.pathname];
  if (Component) {
    // parseSeamData returns { page: { ... } } keyed by loader name;
    // skeleton components expect the procedure output directly.
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
} else if (devRoot) {
  createRoot(devRoot).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
