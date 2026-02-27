/* examples/i18n-demo/seam-app/src/client/pages/about-skeleton.tsx */

import { useT } from "@canmi/seam-i18n/react";

export function AboutSkeleton() {
  const t = useT();

  return (
    <div>
      <h1>{t("about.title")}</h1>
      <p>{t("about.description")}</p>
    </div>
  );
}
