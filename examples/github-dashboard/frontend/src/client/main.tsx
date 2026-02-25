/* examples/github-dashboard/frontend/src/client/main.tsx */

import "./index.css";
import { seamHydrate } from "@canmi/seam-tanstack-router";
import { DATA_ID } from "../generated/client.js";
import routes from "./routes.js";

seamHydrate({
  routes,
  root: document.getElementById("__seam")!,
  dataId: DATA_ID,
});
