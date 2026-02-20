/* examples/github-dashboard/shared/components/profile-header.tsx */

import type { GitHubUser } from "../types.js";

export function ProfileHeader({ user }: { user: GitHubUser }) {
  return (
    <div className="flex items-center gap-6">
      <img
        src={user.avatar_url}
        alt={user.login}
        className="h-20 w-20 rounded-full border-2 border-border"
      />
      <div>
        <h1 className="text-2xl font-bold text-primary">{user.name ?? user.login}</h1>
        <p className="text-secondary">@{user.login}</p>
        {user.bio && <p className="mt-1 text-muted">{user.bio}</p>}
        {user.location && <p className="mt-0.5 text-sm text-muted">{user.location}</p>}
      </div>
    </div>
  );
}
