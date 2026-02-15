/* packages/client/react/src/use-seam-data.ts */

import { createContext, useContext } from "react";

const SeamDataContext = createContext<unknown>(null);

export const SeamDataProvider = SeamDataContext.Provider;

export function useSeamData<T extends Record<string, unknown>>(): T {
  const value = useContext(SeamDataContext);
  if (value === null || value === undefined)
    throw new Error("useSeamData must be used inside <SeamDataProvider>");
  return value as T;
}

export function parseSeamData(): Record<string, unknown> {
  const el = document.getElementById("__SEAM_DATA__");
  if (!el?.textContent) throw new Error("__SEAM_DATA__ not found");
  return JSON.parse(el.textContent) as Record<string, unknown>;
}
