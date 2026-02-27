/* examples/i18n-demo/seam-app/src/client/pages/layout.tsx */

import { useEffect, useState, type ReactNode } from "react";
import { useSeamData } from "@canmi/seam-react";
import { useT, useLocale, useSwitchLocale } from "@canmi/seam-i18n/react";

interface LayoutData extends Record<string, unknown> {
  content: { mode: string };
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useSeamData<LayoutData>();
  const t = useT();
  const locale = useLocale();
  const switchLocale = useSwitchLocale();
  const nextLocale = locale === "en" ? "zh" : "en";
  const isPrefix = data.content?.mode === "prefix";

  // Compute locale-aware prefix after hydration (SSR renders bare links)
  const [prefix, setPrefix] = useState("");
  useEffect(() => {
    if (!isPrefix) return;
    // If current path has a locale prefix, use it for links
    const m = window.location.pathname.match(/^\/([a-z]{2})(?=\/|$)/);
    if (m) setPrefix(`/${m[1]}`);
  }, [isPrefix, locale]);

  const handleSwitch = () => {
    if (isPrefix) {
      const pathname = window.location.pathname;
      const bare = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "") || "/";
      const newPath = nextLocale === "en" ? bare : `/${nextLocale}${bare}`;
      window.location.href = newPath;
    } else {
      void switchLocale(nextLocale, { writeCookie: true, reload: false });
    }
  };

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
        <a href={`${prefix}/`}>{t("nav.home")}</a>
        <a href={`${prefix}/about`}>{t("nav.about")}</a>
        <span style={{ flex: 1 }} />
        <button
          onClick={handleSwitch}
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
