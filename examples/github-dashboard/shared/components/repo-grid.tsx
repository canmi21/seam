/* examples/github-dashboard/shared/components/repo-grid.tsx */

import type { GitHubRepo } from "../types.js";
import { RepoCard } from "./repo-card.js";

export function RepoGrid({ repos }: { repos: GitHubRepo[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {repos.map((repo) => (
        <RepoCard key={repo.id} repo={repo} />
      ))}
    </div>
  );
}
