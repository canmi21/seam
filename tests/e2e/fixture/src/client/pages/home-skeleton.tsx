/* tests/e2e/fixture/src/client/pages/home-skeleton.tsx */

import { useSeamData } from "@canmi/seam-react";

interface HomeData extends Record<string, unknown> {
  title: string;
  message: string;
}

export function HomeSkeleton() {
  const data = useSeamData<HomeData>();

  return (
    <div>
      <h1>{data.title}</h1>
      <p>{data.message}</p>
    </div>
  );
}
