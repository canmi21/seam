/* examples/i18n-demo/seam-app/src/client/pages/home-skeleton.tsx */

import { useT } from "@canmi/seam-i18n/react";

export function HomeSkeleton() {
  const t = useT();

  return (
    <div>
      <h1>{t("home.title")}</h1>
      <p>{t("home.description")}</p>
    </div>
  );
}
