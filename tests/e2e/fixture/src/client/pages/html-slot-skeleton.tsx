/* tests/e2e/fixture/src/client/pages/html-slot-skeleton.tsx */

import { useSeamData } from "@canmi/seam-react";

interface HtmlSlotData extends Record<string, unknown> {
  title: string;
  bodyHtml: string;
}

export function HtmlSlotSkeleton() {
  const data = useSeamData<HtmlSlotData>();

  return (
    <div>
      <h1 data-testid="title">{data.title}</h1>
      <article data-testid="body" dangerouslySetInnerHTML={{ __html: data.bodyHtml }} />
      <a href="/" data-testid="link-home">
        Back to Home
      </a>
    </div>
  );
}
