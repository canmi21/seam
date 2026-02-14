/* examples/standalone/server-bun/src/index.ts */

import { createRouter } from "@canmi/seam-server";
import { serveBun } from "@canmi/seam-adapter-bun";

import { greet } from "./procedures/greet.js";
import { getUser } from "./procedures/get-user.js";
import { listUsers } from "./procedures/list-users.js";
import { onCount } from "./subscriptions/on-count.js";
import { userPage } from "./pages/user.js";

const router = createRouter(
  { greet, getUser, listUsers, onCount },
  { pages: { "/user/:id": userPage } },
);
const port = Number(process.env.PORT) || 3000;
// Dev mode: pass fallback to proxy non-seam requests to a frontend dev server
// import { createDevProxy } from "@canmi/seam-server";
// const server = serveBun(router, { port, fallback: createDevProxy({ target: "http://localhost:5173" }) });
const server = serveBun(router, { port });

console.log(`Seam TS backend running on http://localhost:${server.port}`);
