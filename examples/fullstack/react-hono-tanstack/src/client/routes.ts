/* examples/fullstack/react-hono-tanstack/src/client/routes.ts */

import { defineRoutes } from "@canmi/seam-react";
import { HomeSkeleton } from "./pages/home-skeleton.js";
import { AboutSkeleton } from "./pages/about-skeleton.js";
import { PostsSkeleton } from "./pages/posts-skeleton.js";

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
  {
    path: "/about",
    component: AboutSkeleton,
    loaders: {
      page: { procedure: "getAboutData" },
    },
    mock: {
      teamName: "SeamJS Core",
      description: "Building the next generation of compile-time rendering tools.",
      isHiring: true,
      contactEmail: "team@seamjs.dev",
    },
  },
  {
    path: "/posts",
    component: PostsSkeleton,
    loaders: {
      page: { procedure: "getPosts" },
    },
    mock: {
      heading: "Recent Posts",
      showDrafts: true,
      posts: [
        {
          id: "mock-1",
          title: "Getting Started with SeamJS",
          isPublished: true,
          excerpt: "Learn how to set up CTR in your project.",
          author: "Alice",
        },
      ],
    },
  },
]);
