/* packages/seam-react/__tests__/define-routes.test.ts */

import { describe, it, expect } from "vitest";
import { defineRoutes } from "../src/index.js";

describe("defineRoutes", () => {
  it("returns input unchanged", () => {
    const Comp = () => null;
    const routes = defineRoutes([
      {
        path: "/user/:id",
        component: Comp,
        loaders: { user: { procedure: "getUser", params: { id: { from: "route", type: "int" } } } },
        mock: { user: { id: 1, name: "Alice" } },
        nullable: ["user.avatar"],
      },
    ]);

    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/user/:id");
    expect(routes[0].component).toBe(Comp);
    expect(routes[0].loaders.user.procedure).toBe("getUser");
    expect(routes[0].mock).toEqual({ user: { id: 1, name: "Alice" } });
    expect(routes[0].nullable).toEqual(["user.avatar"]);
  });
});
