/* examples/client-react/src/main.tsx */

import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { UserPage } from "./pages/user-page.js";

// Hydration entry point -- Phase 3C will add proper routing
const root = document.getElementById("__SEAM_ROOT__");
if (root) {
  hydrateRoot(
    root,
    <StrictMode>
      <UserPage />
    </StrictMode>,
  );
}
