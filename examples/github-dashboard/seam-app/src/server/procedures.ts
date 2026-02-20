/* examples/github-dashboard/seam-app/src/server/procedures.ts */

import { t } from "@canmi/seam-server";
import type { ProcedureDef } from "@canmi/seam-server";

const ghHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
};

export const getHomeData: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    tagline: t.string(),
  }),
  handler: () => ({
    tagline: "Compile-Time Rendering for React",
  }),
};

export const getUser: ProcedureDef = {
  input: t.object({ username: t.string() }),
  output: t.object({
    login: t.string(),
    name: t.nullable(t.string()),
    avatar_url: t.string(),
    bio: t.nullable(t.string()),
    location: t.nullable(t.string()),
    public_repos: t.uint32(),
    followers: t.uint32(),
    following: t.uint32(),
  }),
  handler: async ({ input }) => {
    const { username } = input as { username: string };
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
      headers: ghHeaders(),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const d = (await res.json()) as Record<string, unknown>;
    return {
      login: d.login as string,
      name: (d.name as string | null) ?? null,
      avatar_url: d.avatar_url as string,
      bio: (d.bio as string | null) ?? null,
      location: (d.location as string | null) ?? null,
      public_repos: d.public_repos as number,
      followers: d.followers as number,
      following: d.following as number,
    };
  },
};

export const getUserRepos: ProcedureDef = {
  input: t.object({ username: t.string() }),
  output: t.array(
    t.object({
      id: t.uint32(),
      name: t.string(),
      description: t.nullable(t.string()),
      language: t.nullable(t.string()),
      stargazers_count: t.uint32(),
      forks_count: t.uint32(),
      html_url: t.string(),
    }),
  ),
  handler: async ({ input }) => {
    const { username } = input as { username: string };
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=stars&per_page=6`,
      { headers: ghHeaders() },
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const repos = (await res.json()) as Record<string, unknown>[];
    return repos.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      language: (r.language as string | null) ?? null,
      stargazers_count: r.stargazers_count as number,
      forks_count: r.forks_count as number,
      html_url: r.html_url as string,
    }));
  },
};
