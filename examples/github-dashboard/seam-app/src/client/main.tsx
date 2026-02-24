/* examples/github-dashboard/seam-app/src/client/main.tsx */

import "./index.css";
import { seamHydrate } from "@canmi/seam-tanstack-router";
import routes from "./routes.js";

seamHydrate({
  routes,
  root: document.getElementById("__seam")!,
});
