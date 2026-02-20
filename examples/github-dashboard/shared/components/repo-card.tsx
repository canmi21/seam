/* examples/github-dashboard/shared/components/repo-card.tsx */

import type { GitHubRepo } from "../types.js";

export function RepoCard({ repo }: { repo: GitHubRepo }) {
  return (
    <a
      href={repo.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-border bg-surface p-5 transition-shadow hover:shadow-md"
    >
      <h3 className="text-lg font-semibold text-accent">{repo.name}</h3>
      {repo.description && (
        <p className="mt-1 text-sm text-secondary line-clamp-2">{repo.description}</p>
      )}
      <div className="mt-3 flex items-center gap-4 text-sm text-muted">
        {repo.language && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-muted" />
            {repo.language}
          </span>
        )}
        <span className="flex items-center gap-1">
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z" />
          </svg>
          {repo.stargazers_count}
        </span>
        <span className="flex items-center gap-1">
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 10 0-1.5.75.75 0 000 1.5zm-3 8.75a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" />
          </svg>
          {repo.forks_count}
        </span>
      </div>
    </a>
  );
}
