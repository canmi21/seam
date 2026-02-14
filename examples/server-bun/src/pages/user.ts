/* examples/server-bun/src/pages/user.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { definePage } from "@canmi/seam-server";

const template = readFileSync(
  resolve(import.meta.dirname, "../../../templates/user.html"),
  "utf-8",
);

export const userPage = definePage({
  template,
  loaders: {
    user: (params) => ({
      procedure: "getUser",
      input: { id: Number(params.id) },
    }),
  },
});
