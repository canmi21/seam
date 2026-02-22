/* packages/client/tanstack-router/__tests__/create-loader.test.ts */

import { describe, expect, it, vi } from "vitest";
import { buildInput, createLoaderFromDefs } from "../src/create-loader.js";
import type { SeamRouterContext } from "../src/types.js";

describe("buildInput()", () => {
  it("maps route params to input", () => {
    const result = buildInput(
      { procedure: "getUser", params: { username: { from: "route" } } },
      { username: "octocat" },
    );
    expect(result).toEqual({ username: "octocat" });
  });

  it("coerces int params", () => {
    const result = buildInput(
      { procedure: "getItem", params: { id: { from: "route", type: "int" } } },
      { id: "42" },
    );
    expect(result).toEqual({ id: 42 });
  });

  it("returns empty object when no params defined", () => {
    const result = buildInput({ procedure: "getHomeData" }, {});
    expect(result).toEqual({});
  });
});

describe("createLoaderFromDefs()", () => {
  it("short-circuits on first load using initial data", async () => {
    const initial = {
      path: "/dashboard/:username",
      params: { username: "octocat" },
      data: { user: { login: "octocat" }, repos: [] },
      consumed: false,
    };

    const loader = createLoaderFromDefs(
      {
        user: { procedure: "getUser", params: { username: { from: "route" } } },
        repos: { procedure: "getUserRepos", params: { username: { from: "route" } } },
      },
      "/dashboard/:username",
    );

    const context: SeamRouterContext = {
      seamRpc: vi.fn(),
      _seamInitial: initial,
    };

    const result = await loader({ params: { username: "octocat" }, context });

    expect(result).toEqual({ user: { login: "octocat" }, repos: [] });
    expect(initial.consumed).toBe(true);
    expect(context.seamRpc).not.toHaveBeenCalled();
  });

  it("calls RPC on SPA navigation (after initial consumed)", async () => {
    const mockRpc = vi.fn();
    mockRpc.mockResolvedValueOnce({ login: "torvalds" });
    mockRpc.mockResolvedValueOnce([{ name: "linux" }]);

    const loader = createLoaderFromDefs(
      {
        user: { procedure: "getUser", params: { username: { from: "route" } } },
        repos: { procedure: "getUserRepos", params: { username: { from: "route" } } },
      },
      "/dashboard/:username",
    );

    const context: SeamRouterContext = {
      seamRpc: mockRpc,
      _seamInitial: { path: "/", params: {}, data: {}, consumed: true },
    };

    const result = await loader({ params: { username: "torvalds" }, context });

    expect(result).toEqual({ user: { login: "torvalds" }, repos: [{ name: "linux" }] });
    expect(mockRpc).toHaveBeenCalledWith("getUser", { username: "torvalds" });
    expect(mockRpc).toHaveBeenCalledWith("getUserRepos", { username: "torvalds" });
  });

  it("calls RPC when no initial data", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ tagline: "Hello" });

    const loader = createLoaderFromDefs({ page: { procedure: "getHomeData" } }, "/");

    const context: SeamRouterContext = {
      seamRpc: mockRpc,
      _seamInitial: null,
    };

    const result = await loader({ params: {}, context });

    expect(result).toEqual({ page: { tagline: "Hello" } });
    expect(mockRpc).toHaveBeenCalledWith("getHomeData", {});
  });
});
