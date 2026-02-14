/* examples/server-bun/src/index-react.ts */

import { createRouter, loadBuildOutput } from "@canmi/seam-server";
import { serveBun } from "@canmi/seam-adapter-bun";
import { resolve } from "node:path";

import { greet } from "./procedures/greet.js";
import { getUser } from "./procedures/get-user.js";
import { listUsers } from "./procedures/list-users.js";

const distDir = resolve(import.meta.dirname, "../../../frontend-react/dist");
const pages = loadBuildOutput(distDir);
const router = createRouter({ greet, getUser, listUsers }, { pages });

const port = Number(process.env.PORT) || 3000;
const server = serveBun(router, {
  port,
  staticDir: `${distDir}/assets`,
});

console.log(`Seam React backend running on http://localhost:${server.port}`);
