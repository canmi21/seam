/* examples/fs-router-demo/src/pages/page.tsx */

import { useSeamData } from "@canmi/seam-react";

interface HomeData extends Record<string, unknown> {
  page: { title: string; description: string };
}

export default function HomePage() {
  const data = useSeamData<HomeData>();
  return (
    <div>
      <h1>{data.page.title}</h1>
      <p>{data.page.description}</p>
    </div>
  );
}
