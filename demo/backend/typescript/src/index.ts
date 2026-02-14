import { createRouter } from "@canmi/seam-server";
import { serveBun } from "@canmi/seam-adapter-bun";

import { greet } from "./procedures/greet.js";
import { getUser } from "./procedures/get-user.js";
import { listUsers } from "./procedures/list-users.js";

const router = createRouter({ greet, getUser, listUsers });
const server = serveBun(router, { port: 3000 });

console.log(`Seam TS backend running on http://localhost:${server.port}`);
