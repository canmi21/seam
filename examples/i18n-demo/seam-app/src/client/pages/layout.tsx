/* examples/i18n-demo/seam-app/src/client/pages/layout.tsx */

import type { ReactNode } from "react";
import { useT, useLocale, useSwitchLocale } from "@canmi/seam-i18n/react";

export function Layout({ children }: { children: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const switchLocale = useSwitchLocale();
  const nextLocale = locale === "en" ? "zh" : "en";

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "2rem 1rem" }}>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          marginBottom: "2rem",
          borderBottom: "1px solid #e5e7eb",
          paddingBottom: "1rem",
        }}
      >
        <a href="/">{t("nav.home")}</a>
        <a href="/about">{t("nav.about")}</a>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => void switchLocale(nextLocale, { writeCookie: true })}
          style={{
            padding: "0.25rem 0.75rem",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            background: "none",
            cursor: "pointer",
          }}
        >
          {nextLocale.toUpperCase()}
        </button>
      </nav>
      {children}
    </div>
  );
}
