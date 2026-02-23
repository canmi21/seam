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
      <nav>
        <ul>
          <li>
            <a href="/react19" data-testid="link-react19">
              React 19
            </a>
          </li>
          <li>
            <a href="/form" data-testid="link-form">
              Form
            </a>
          </li>
          <li>
            <a href="/error" data-testid="link-error">
              Error Boundary
            </a>
          </li>
          <li>
            <a href="/async" data-testid="link-async">
              Async Loading
            </a>
          </li>
          <li>
            <a href="/test-html" data-testid="link-html-slot">
              HTML Slot
            </a>
          </li>
        </ul>
      </nav>
    </div>
  );
}
