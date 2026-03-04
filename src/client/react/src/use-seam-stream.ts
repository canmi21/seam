/* src/client/react/src/use-seam-stream.ts */

import { useCallback, useEffect, useRef, useState } from "react";
import { SeamClientError, parseSseStream } from "@canmi/seam-client";

export type StreamStatus = "idle" | "streaming" | "completed" | "error";

export interface UseSeamStreamResult<T> {
  chunks: T[];
  latestChunk: T | null;
  status: StreamStatus;
  error: SeamClientError | null;
  cancel: () => void;
}

export function useSeamStream<T>(
  baseUrl: string,
  procedure: string,
  input: unknown,
): UseSeamStreamResult<T> {
  const [chunks, setChunks] = useState<T[]>([]);
  const [error, setError] = useState<SeamClientError | null>(null);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const controllerRef = useRef<AbortController | null>(null);

  // Serialize input for stable dependency
  const inputKey = JSON.stringify(input);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    setChunks([]);
    setError(null);
    setStatus("streaming");

    const controller = new AbortController();
    controllerRef.current = controller;

    const cleanBase = baseUrl.replace(/\/+$/, "");
    const url = `${cleanBase}/_seam/procedure/${procedure}`;

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: inputKey,
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok || !res.body) {
          setError(new SeamClientError("INTERNAL_ERROR", `HTTP ${res.status}`, res.status));
          setStatus("error");
          return;
        }
        return parseSseStream(res.body.getReader(), {
          onData(data) {
            setChunks((prev) => [...prev, data as T]);
          },
          onError(err) {
            setError(new SeamClientError(err.code, err.message, 0));
            setStatus("error");
          },
          onComplete() {
            setStatus("completed");
          },
        });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(new SeamClientError("INTERNAL_ERROR", err.message ?? "Stream failed", 0));
        setStatus("error");
      });

    return () => {
      controller.abort();
    };
  }, [baseUrl, procedure, inputKey]);

  const latestChunk = chunks.length > 0 ? chunks[chunks.length - 1] : null;

  return { chunks, latestChunk, status, error, cancel };
}
