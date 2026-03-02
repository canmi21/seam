/* examples/fs-router-demo/src/pages/(marketing)/layout.tsx */

import type { ReactNode } from "react";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div id="marketing-layout">{children}</div>;
}
