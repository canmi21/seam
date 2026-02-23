/* examples/github-dashboard/shared/components/app-layout.tsx */

import type { ReactNode } from "react";

/** Transparent layout wrapper — will gain shared UI after CTR build supports layout composition */
export function AppLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
