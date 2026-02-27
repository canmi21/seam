/* examples/i18n-demo/seam-app/src/client/main.tsx */

import { seamHydrate } from "@canmi/seam-tanstack-router";
import routes from "./routes.js";

seamHydrate({
  routes,
  root: document.getElementById("__seam")!,
  cleanLocaleQuery: true,
});
