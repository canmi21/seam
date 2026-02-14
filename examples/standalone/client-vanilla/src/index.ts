/* examples/standalone/client-vanilla/src/index.ts */

import { createSeamClient } from "./generated/client.js";

const api = createSeamClient("http://localhost:3000");

const greeting = await api.greet({ name: "World" });
console.log("greet:", greeting);

const user = await api.getUser({ id: 1 });
console.log("getUser:", user);

const users = await api.listUsers({});
console.log("listUsers:", users);
