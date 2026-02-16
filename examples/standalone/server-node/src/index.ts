/* examples/standalone/server-node/src/index.ts */

import { createRouter } from "@canmi/seam-server";
import { serveNode } from "@canmi/seam-adapter-node";

import { greet } from "../../server-bun/src/procedures/greet.js";
import { getUser } from "../../server-bun/src/procedures/get-user.js";
import { listUsers } from "../../server-bun/src/procedures/list-users.js";
import { onCount } from "../../server-bun/src/subscriptions/on-count.js";
import { userPage } from "../../server-bun/src/pages/user.js";

const router = createRouter(
  { greet, getUser, listUsers, onCount },
  { pages: { "/user/:id": userPage } },
);
const port = Number(process.env.PORT) || 3000;
// Dev mode: pass fallback + wsProxy to proxy non-seam requests to a frontend dev server
// import { createDevProxy } from "@canmi/seam-server";
// serveNode(router, { port, fallback: createDevProxy({ target: "http://localhost:5173" }), wsProxy: "ws://localhost:5173" });
serveNode(router, { port });
console.log(`Seam Node backend running on http://localhost:${port}`);
