/* examples/github-dashboard/shared/components/app-layout.tsx */

import type { ReactNode } from "react";
import { useSeamData } from "@canmi/seam-react";
import { DarkModeToggle } from "./dark-mode-toggle.js";

interface SessionData {
  session: { username: string; theme: string };
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { session } = useSeamData<SessionData>();

  return (
    <div className="relative min-h-screen bg-surface">
      <div className="fixed right-4 top-4 z-50 flex items-center gap-3">
        <span className="text-sm text-muted">Hello, {session.username}</span>
        <DarkModeToggle />
      </div>
      {children}
    </div>
  );
}
