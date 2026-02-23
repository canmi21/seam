/* examples/github-dashboard/shared/components/app-layout.tsx */

import type { ReactNode } from "react";
import { DarkModeToggle } from "./dark-mode-toggle.js";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-surface">
      <div className="fixed right-4 top-4 z-50">
        <DarkModeToggle />
      </div>
      {children}
    </div>
  );
}
