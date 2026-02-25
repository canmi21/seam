/* examples/github-dashboard/frontend/src/client/pages/home-skeleton.tsx */

import { useSeamData, useSeamNavigate, useT } from "@canmi/seam-react";
import { UsernameForm } from "@github-dashboard/shared/components/username-form.js";

interface HomeData extends Record<string, unknown> {
  tagline: string;
}

export function HomeSkeleton() {
  const data = useSeamData<HomeData>();
  const navigate = useSeamNavigate();
  const t = useT();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <h1 className="mb-2 text-4xl font-bold text-primary">{t("dashboard.title")}</h1>
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
