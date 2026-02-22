/* examples/github-dashboard/seam-app/src/client/pages/home-skeleton.tsx */

import { useSeamData, useSeamNavigate } from "@canmi/seam-react";
import { DarkModeToggle } from "@github-dashboard/shared/components/dark-mode-toggle.js";
import { UsernameForm } from "@github-dashboard/shared/components/username-form.js";

interface HomeData extends Record<string, unknown> {
  tagline: string;
}

export function HomeSkeleton() {
  const data = useSeamData<HomeData>();
  const navigate = useSeamNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
      <div className="absolute right-4 top-4">
        <DarkModeToggle />
      </div>
      <h1 className="mb-2 text-4xl font-bold text-primary">GitHub Dashboard</h1>
      <p className="mb-8 text-lg text-secondary">{data.tagline}</p>
      <div className="w-full max-w-md">
        <UsernameForm
          onSubmit={(username) => {
            navigate(`/dashboard/${username}`);
          }}
        />
      </div>
    </div>
  );
}
