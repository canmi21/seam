/* examples/fullstack/react-hono-tanstack/src/client/routes.ts */

import { defineRoutes } from "@canmi/seam-react";
import { HomeSkeleton } from "./pages/home-skeleton.js";

export default defineRoutes([
  {
    path: "/",
    component: HomeSkeleton,
    loaders: {
      page: { procedure: "getPageData" },
    },
    mock: {
      title: "SeamJS Dashboard",
      isAdmin: true,
      isLoggedIn: true,
      subtitle: "Compile-Time Rendering Demo",
      role: "admin",
      posts: [
        {
          id: "mock-1",
          title: "Getting Started with SeamJS",
          isPublished: true,
          priority: "high",
          author: "Alice",
          tags: [{ name: "tutorial" }, { name: "intro" }],
        },
      ],
    },
  },
]);
