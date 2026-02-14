/* demo/backend/typescript/src/index.ts */

import { createRouter } from "@canmi/seam-server";
import { serveBun } from "@canmi/seam-adapter-bun";

import { greet } from "./procedures/greet.js";
import { getUser } from "./procedures/get-user.js";
import { listUsers } from "./procedures/list-users.js";
import { userPage } from "./pages/user.js";

const router = createRouter({ greet, getUser, listUsers }, { pages: { "/user/:id": userPage } });
const port = Number(process.env.PORT) || 3000;
const server = serveBun(router, { port });

console.log(`Seam TS backend running on http://localhost:${server.port}`);
