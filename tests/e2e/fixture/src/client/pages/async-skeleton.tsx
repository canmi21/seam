/* tests/e2e/fixture/src/client/pages/async-skeleton.tsx */

import { useEffect, useState } from "react";
import { useSeamData } from "@canmi/seam-react";

interface AsyncData extends Record<string, unknown> {
  heading: string;
}

interface AsyncItem {
  id: number;
  label: string;
}

export function AsyncSkeleton() {
  const data = useSeamData<AsyncData>();
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [items, setItems] = useState<AsyncItem[]>([]);

  // eslint-disable-next-line seam/no-effect-in-skeleton -- client-only fetch
  useEffect(() => {
    fetch("/_seam/rpc/getAsyncItems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((json: { items?: AsyncItem[] }) => {
        setItems(json.items ?? []);
        setState("loaded");
      })
      .catch(() => {
        setState("error");
      });
  }, []);

  return (
    <div>
      <h1>{data.heading}</h1>
      {state === "loading" && <p data-testid="loading">Loading items...</p>}
      {state === "loaded" && (
        <ul data-testid="async-list">
          {items.map((item) => (
            <li key={item.id} data-testid="async-item">
              {item.label}
            </li>
          ))}
        </ul>
      )}
      {state === "error" && <p data-testid="async-error">Failed to load items.</p>}
      <a href="/" data-testid="link-home">
        Back to Home
      </a>
    </div>
  );
}
