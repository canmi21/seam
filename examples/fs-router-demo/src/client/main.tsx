/* examples/fs-router-demo/src/client/main.tsx */

import { seamHydrate } from "@canmi/seam-tanstack-router";
import { DATA_ID } from "../generated/client.js";
import routes from "../../.seam/generated/routes.js";

seamHydrate({
  routes,
  root: document.getElementById("__seam")!,
  dataId: DATA_ID,
});
