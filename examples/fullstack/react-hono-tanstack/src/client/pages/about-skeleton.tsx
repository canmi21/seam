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
    <div className="mx-auto max-w-2xl px-6 py-10">
      {/* Nav */}
      <nav className="mb-10 flex items-center gap-6 text-sm">
        <span className="font-semibold text-accent">SeamJS</span>
        <a href="/" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">Home</a>
        <a href="/about" className="font-medium text-accent">About</a>
        <a href="/posts" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">Posts</a>
      </nav>

      <header className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            {data.teamName}
          </h1>
          {data.isHiring && (
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
              Hiring
            </span>
          )}
        </div>
        <p className="mt-3 text-base text-neutral-600 dark:text-neutral-400">{data.description}</p>
      </header>

      {data.contactEmail && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Contact: <span className="text-accent">{data.contactEmail}</span>
        </p>
      )}

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-400 dark:border-neutral-800">
        Built with <span className="text-accent">SeamJS</span>
      </footer>
    </div>
  );
}
