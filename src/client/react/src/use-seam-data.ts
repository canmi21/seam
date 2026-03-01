/* src/client/react/src/use-seam-data.ts */

import { createContext, useContext } from "react";

const SeamDataContext = createContext<unknown>(null);

export const SeamDataProvider = SeamDataContext.Provider;

export function useSeamData<T extends object = Record<string, unknown>>(): T {
  const value = useContext(SeamDataContext);
  if (value === null || value === undefined)
    throw new Error("useSeamData must be used inside <SeamDataProvider>");
  return value as T;
}

export function parseSeamData(dataId = "__data"): Record<string, unknown> {
  const el = document.getElementById(dataId);
  if (!el?.textContent) throw new Error(`${dataId} not found`);
  return JSON.parse(el.textContent) as Record<string, unknown>;
}
