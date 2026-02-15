/* examples/fullstack/react-hono-tanstack/src/client/main.tsx */

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { SeamDataProvider, parseSeamData } from "@canmi/seam-react";
import { App } from "./app.js";
import { HomeSkeleton } from "./pages/home-skeleton.js";
import "./index.css";

const seamRoot = document.getElementById("__SEAM_ROOT__");
const devRoot = document.getElementById("root");

if (seamRoot) {
  const data = parseSeamData();
  hydrateRoot(
    seamRoot,
    <StrictMode>
      <SeamDataProvider value={data}>
        <HomeSkeleton />
      </SeamDataProvider>
    </StrictMode>,
  );
} else if (devRoot) {
  createRoot(devRoot).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
