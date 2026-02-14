/* packages/client/react/src/use-seam-subscription.ts */

import { useEffect, useRef, useState } from "react";
import { SeamClientError } from "@canmi/seam-client";

export type SubscriptionStatus = "connecting" | "active" | "error" | "closed";

export interface UseSeamSubscriptionResult<T> {
  data: T | null;
  error: SeamClientError | null;
  status: SubscriptionStatus;
}

export function useSeamSubscription<T>(
  baseUrl: string,
  procedure: string,
  input: unknown,
): UseSeamSubscriptionResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<SeamClientError | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus>("connecting");

  // Serialize input for stable dependency
  const inputKey = JSON.stringify(input);
  const inputRef = useRef(inputKey);
  inputRef.current = inputKey;

  useEffect(() => {
    setData(null);
    setError(null);
    setStatus("connecting");

    const cleanBase = baseUrl.replace(/\/+$/, "");
    const params = new URLSearchParams({ input: inputKey });
    const url = `${cleanBase}/_seam/subscribe/${procedure}?${params.toString()}`;
    const es = new EventSource(url);

    es.addEventListener("data", (e) => {
      try {
        setData(JSON.parse(e.data as string) as T);
        setStatus("active");
      } catch {
        setError(new SeamClientError("INTERNAL_ERROR", "Failed to parse SSE data", 0));
        setStatus("error");
        es.close();
      }
    });

    es.addEventListener("error", (e) => {
      if (e instanceof MessageEvent) {
        try {
          const payload = JSON.parse(e.data as string) as { code?: string; message?: string };
          setError(
            new SeamClientError(
              "INTERNAL_ERROR",
              typeof payload.message === "string" ? payload.message : "SSE error",
              0,
            ),
          );
        } catch {
          setError(new SeamClientError("INTERNAL_ERROR", "SSE error", 0));
        }
      } else {
        setError(new SeamClientError("INTERNAL_ERROR", "SSE connection error", 0));
      }
      setStatus("error");
      es.close();
    });

    es.addEventListener("complete", () => {
      setStatus("closed");
      es.close();
    });

    return () => {
      es.close();
    };
  }, [baseUrl, procedure, inputKey]);

  return { data, error, status };
}
