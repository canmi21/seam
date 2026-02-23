/* examples/github-dashboard/seam-app/src/client/pages/dashboard-skeleton.tsx */

import { useEffect, useState } from "react";
import { useSeamData } from "@canmi/seam-react";
import type { DashboardData } from "@github-dashboard/shared/types.js";
import { DarkModeToggle } from "@github-dashboard/shared/components/dark-mode-toggle.js";
import { ProfileHeader } from "@github-dashboard/shared/components/profile-header.js";
import { StatsBar } from "@github-dashboard/shared/components/stats-bar.js";
import { RepoGrid } from "@github-dashboard/shared/components/repo-grid.js";

export function DashboardSkeleton() {
  const data = useSeamData<DashboardData & Record<string, unknown>>();
  const [timing, setTiming] = useState("");

  useEffect(() => {
    const el = document.getElementById("__SEAM_DATA__");
    if (el) {
      const raw = JSON.parse(el.textContent || "{}");
      if (raw._meta?.timing) {
        setTiming(raw._meta.timing);
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-surface px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <a href="/" className="text-sm text-accent hover:text-accent-hover">
            &larr; Back
          </a>
          <DarkModeToggle />
        </div>

        <ProfileHeader user={data.user} />

        <div className="my-6">
          <StatsBar
            publicRepos={data.user.public_repos}
            followers={data.user.followers}
            following={data.user.following}
          />
        </div>

        <h2 className="mb-4 text-xl font-semibold text-primary">Top Repositories</h2>
        <RepoGrid repos={data.repos} />

        <footer className="mt-8 border-t border-border pt-4 text-center text-sm text-muted">
          Rendered via SeamJS CTR{timing}
        </footer>
      </div>
    </div>
  );
}
