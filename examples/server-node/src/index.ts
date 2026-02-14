/* examples/server-node/src/index.ts */

import { createRouter } from "@canmi/seam-server";
import { serveNode } from "@canmi/seam-adapter-node";

import { greet } from "../../typescript/src/procedures/greet.js";
import { getUser } from "../../typescript/src/procedures/get-user.js";
import { listUsers } from "../../typescript/src/procedures/list-users.js";
import { onCount } from "../../server-bun/src/subscriptions/on-count.js";
import { userPage } from "../../typescript/src/pages/user.js";

const router = createRouter(
  { greet, getUser, listUsers, onCount },
  { pages: { "/user/:id": userPage } },
);
const port = Number(process.env.PORT) || 3000;
serveNode(router, { port });
console.log(`Seam Node backend running on http://localhost:${port}`);
