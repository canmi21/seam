/* examples/fs-router-demo/src/pages/layout.tsx */

import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div id="root-layout">
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
        <a href="/blog/hello-world">Blog</a>
        <a href="/pricing">Pricing</a>
        <a href="/features">Features</a>
        <a href="/docs">Docs</a>
      </nav>
      <main>{children}</main>
    </div>
  )
}
