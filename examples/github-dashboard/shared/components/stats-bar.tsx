/* examples/github-dashboard/shared/components/stats-bar.tsx */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-alt px-5 py-3 text-center">
      <p className="text-2xl font-semibold text-primary">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

export function StatsBar({
  publicRepos,
  followers,
  following,
}: {
  publicRepos: number;
  followers: number;
  following: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Stat label="Repos" value={publicRepos} />
      <Stat label="Followers" value={followers} />
      <Stat label="Following" value={following} />
    </div>
  );
}
