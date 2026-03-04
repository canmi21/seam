/* src/client/react/src/use-seam-handoff.ts */

import { createContext, useContext } from "react";

const SeamHandoffContext = createContext<string[]>([]);

export const SeamHandoffProvider = SeamHandoffContext.Provider;

/** Returns the list of loader keys marked as handoff: "client" for the current route/layout */
export function useSeamHandoff(): string[] {
  return useContext(SeamHandoffContext);
}
