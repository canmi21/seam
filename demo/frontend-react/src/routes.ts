/* demo/frontend-react/src/routes.ts */

import { defineRoutes } from "@canmi/seam-react";
import { UserPage } from "./pages/user-page.js";

export default defineRoutes([
  {
    path: "/user/:id",
    component: UserPage,
    loaders: {
      user: {
        procedure: "getUser",
        params: { id: { from: "route", type: "int" } },
      },
    },
    mock: {
      user: {
        id: 1,
        name: "Alice",
        email: "alice@example.com",
        avatar: "https://example.com/alice.png",
      },
    },
    nullable: ["user.avatar"],
  },
]);
