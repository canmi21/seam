/* tests/e2e/fixture/src/client/routes.ts */

import { defineRoutes } from "@canmi/seam-react";
import { HomeSkeleton } from "./pages/home-skeleton.js";
import { React19Skeleton } from "./pages/react19-skeleton.js";
import { FormSkeleton } from "./pages/form-skeleton.js";
import { ErrorSkeleton } from "./pages/error-skeleton.js";
import { AsyncSkeleton } from "./pages/async-skeleton.js";

export default defineRoutes([
  {
    path: "/",
    component: HomeSkeleton,
    loaders: {
      page: { procedure: "getHomeData" },
    },
    mock: {
      title: "E2E Fixture",
      message: "Hydration test page.",
    },
  },
  {
    path: "/react19",
    component: React19Skeleton,
    loaders: {
      page: { procedure: "getReact19Data" },
    },
    mock: {
      heading: "React 19 Features",
      description:
        "Demonstrating useId, Suspense, useState, useRef, useMemo, and metadata hoisting.",
    },
  },
  {
    path: "/form",
    component: FormSkeleton,
    loaders: {
      page: { procedure: "getFormPageData" },
    },
    mock: {
      heading: "Contact Form",
    },
  },
  {
    path: "/error",
    component: ErrorSkeleton,
    loaders: {
      page: { procedure: "getErrorPageData" },
    },
    mock: {
      heading: "Error Boundary Test",
    },
  },
  {
    path: "/async",
    component: AsyncSkeleton,
    loaders: {
      page: { procedure: "getAsyncPageData" },
    },
    mock: {
      heading: "Async Loading Test",
    },
  },
]);
