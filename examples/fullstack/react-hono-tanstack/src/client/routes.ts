/* examples/fullstack/react-hono-tanstack/src/client/routes.ts */

import { defineRoutes } from "@canmi/seam-react";
import { HomeSkeleton } from "./pages/home-skeleton.js";

export default defineRoutes([
  {
    path: "/",
    component: HomeSkeleton,
    loaders: {
      messages: { procedure: "getMessages" },
    },
    mock: {
      messages: [
        { id: "mock-1", text: "Welcome to SeamJS!", createdAt: "2025-01-01T00:00:00Z" },
      ],
    },
  },
]);
