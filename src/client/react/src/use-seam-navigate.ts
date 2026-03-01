/* src/client/react/src/use-seam-navigate.ts */

import { createContext, useContext } from "react";

const SeamNavigateContext = createContext<(url: string) => void>((url) => {
  globalThis.location.href = url;
});

export const SeamNavigateProvider = SeamNavigateContext.Provider;

export function useSeamNavigate(): (url: string) => void {
  return useContext(SeamNavigateContext);
}
