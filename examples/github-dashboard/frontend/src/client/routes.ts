/* examples/github-dashboard/frontend/src/client/routes.ts */

import { defineSeamRoutes } from "@canmi/seam-tanstack-router/routes";
import { AppLayout } from "./components/app-layout.js";
import { HomeSkeleton } from "./pages/home-skeleton.js";
import { DashboardSkeleton } from "./pages/dashboard-skeleton.js";

export default defineSeamRoutes([
  {
    path: "/",
    layout: AppLayout,
    staleTime: 300_000,
    loaders: {
      session: { procedure: "getSession" },
    },
    mock: {
      session: { username: "visitor", theme: "light" },
    },
    children: [
      {
        path: "/",
        component: HomeSkeleton,
        loaders: {
          page: { procedure: "getHomeData" },
        },
        mock: {
          tagline: "Compile-Time Rendering for React",
        },
      },
      {
        path: "/dashboard/:username",
        component: DashboardSkeleton,
        loaders: {
          user: {
            procedure: "getUser",
            params: { username: { from: "route" } },
          },
          repos: {
            procedure: "getUserRepos",
            params: { username: { from: "route" } },
          },
        },
        mock: {
          user: {
            login: "octocat",
            name: "The Octocat",
            avatar_url: "https://github.com/octocat.png",
            bio: "GitHub mascot",
            location: "San Francisco",
            public_repos: 8,
            followers: 1000,
            following: 0,
          },
          repos: [
            {
              id: 1,
              name: "hello-world",
              description: "A test repository",
              language: "JavaScript",
              stargazers_count: 100,
              forks_count: 50,
              html_url: "https://github.com/octocat/hello-world",
            },
            {
              id: 2,
              name: "spoon-knife",
              description: null,
              language: null,
              stargazers_count: 42,
              forks_count: 12,
              html_url: "https://github.com/octocat/Spoon-Knife",
            },
          ],
        },
        nullable: [
          "user.name",
          "user.bio",
          "user.location",
          "repos.$.description",
          "repos.$.language",
        ],
      },
    ],
  },
]);
