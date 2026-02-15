/* examples/fullstack/react-hono-tanstack/src/server/router.ts */

import { createRouter } from "@canmi/seam-server";
import { getMessages, addMessage } from "./procedures.js";
import { onMessage } from "./subscriptions.js";

export const router = createRouter({ getMessages, addMessage, onMessage });
