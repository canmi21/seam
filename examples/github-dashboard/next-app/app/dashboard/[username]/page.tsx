/* examples/github-dashboard/next-app/app/dashboard/[username]/page.tsx */

import type { GitHubUser, GitHubRepo } from "@github-dashboard/shared/types.js";
import { ProfileHeader } from "@github-dashboard/shared/components/profile-header.js";
import { StatsBar } from "@github-dashboard/shared/components/stats-bar.js";
import { RepoGrid } from "@github-dashboard/shared/components/repo-grid.js";

const ghHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
};

async function fetchUser(username: string): Promise<GitHubUser> {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers: ghHeaders(),
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
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
}

async function fetchRepos(username: string): Promise<GitHubRepo[]> {
  const res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=stars&per_page=6`,
    { headers: ghHeaders(), next: { revalidate: 60 } },
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
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
}

export default async function DashboardPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [user, repos] = await Promise.all([fetchUser(username), fetchRepos(username)]);

  return (
    <div className="min-h-screen bg-surface px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <a href="/" className="text-sm text-accent hover:text-accent-hover">
            &larr; Back
          </a>
        </div>

        <ProfileHeader user={user} />

        <div className="my-6">
          <StatsBar
            publicRepos={user.public_repos}
            followers={user.followers}
            following={user.following}
          />
        </div>

        <h2 className="mb-4 text-xl font-semibold text-primary">Top Repositories</h2>
        <RepoGrid repos={repos} />

        <footer className="mt-8 border-t border-border pt-4 text-center text-sm text-muted">
          Rendered via Next.js SSR
        </footer>
      </div>
    </div>
  );
}
