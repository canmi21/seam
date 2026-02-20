/* examples/github-dashboard/next-app/app/layout.tsx */

import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "GitHub Dashboard (Next.js SSR)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-surface text-primary">{children}</body>
    </html>
  );
}
