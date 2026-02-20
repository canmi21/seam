/* examples/github-dashboard/next-app/app/page.tsx */

import { DarkModeToggle } from "./dark-mode-wrapper.js";
import { UsernameFormWrapper } from "./username-form-wrapper.js";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
      <div className="absolute right-4 top-4">
        <DarkModeToggle />
      </div>
      <h1 className="mb-2 text-4xl font-bold text-primary">GitHub Dashboard</h1>
      <p className="mb-8 text-lg text-secondary">Server-Side Rendering with Next.js</p>
      <div className="w-full max-w-md">
        <UsernameFormWrapper />
      </div>
    </div>
  );
}
