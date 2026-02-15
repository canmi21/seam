/* examples/fullstack/react-hono-tanstack/src/client/main.tsx */

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./app.js";
import { HomeSkeleton } from "./pages/home-skeleton.js";
import "./index.css";

const seamRoot = document.getElementById("__SEAM_ROOT__");
const devRoot = document.getElementById("root");

if (seamRoot) {
  hydrateRoot(
    seamRoot,
    <StrictMode>
      <HomeSkeleton />
    </StrictMode>,
  );
} else if (devRoot) {
  createRoot(devRoot).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
