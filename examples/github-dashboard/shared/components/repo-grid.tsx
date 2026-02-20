/* examples/github-dashboard/shared/components/repo-grid.tsx */

import type { GitHubRepo } from "../types.js";
import { RepoCard } from "./repo-card.js";

export function RepoGrid({ repos }: { repos: GitHubRepo[] }) {
  if (repos.length === 0) {
    return <p className="text-center text-muted">No repositories found.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {repos.map((repo) => (
        <RepoCard key={repo.id} repo={repo} />
      ))}
    </div>
  );
}
