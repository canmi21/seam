/* examples/i18n-demo/seam-app/src/client/routes.ts */

import { defineSeamRoutes } from "@canmi/seam-tanstack-router/routes";
import { Layout } from "./pages/layout.js";
import { HomeSkeleton } from "./pages/home-skeleton.js";
import { AboutSkeleton } from "./pages/about-skeleton.js";

export default defineSeamRoutes([
  {
    path: "/",
    layout: Layout,
    loaders: {
      content: { procedure: "getContent" },
    },
    mock: {
      content: { mode: "prefix" },
    },
    children: [
      {
        path: "/",
        component: HomeSkeleton,
      },
      {
        path: "/about",
        component: AboutSkeleton,
      },
    ],
  },
]);
