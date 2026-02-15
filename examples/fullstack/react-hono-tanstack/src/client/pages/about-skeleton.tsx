/* examples/fullstack/react-hono-tanstack/src/client/pages/about-skeleton.tsx */

import { useSeamData } from "@canmi/seam-react";

interface AboutData extends Record<string, unknown> {
  teamName: string;
  description: string;
  isHiring: boolean;
  contactEmail: string | null;
}

export function AboutSkeleton() {
  const data = useSeamData<AboutData>();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {data.teamName}
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{data.description}</p>
      </header>

      {data.isHiring && (
        <span className="mb-4 inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
          Hiring
        </span>
      )}

      {data.contactEmail && (
        <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
          Contact: {data.contactEmail}
        </p>
      )}

      <footer className="mt-10 text-xs text-neutral-400">Powered by SeamJS CTR</footer>
    </div>
  );
}
