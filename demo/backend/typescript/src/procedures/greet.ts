/* demo/backend/typescript/src/procedures/greet.ts */

import { t } from "@canmi/seam-server";
import type { ProcedureDef } from "@canmi/seam-server";

export const greet: ProcedureDef<{ name: string }, { message: string }> = {
  input: t.object({ name: t.string() }),
  output: t.object({ message: t.string() }),
  handler: ({ input }) => {
    return { message: `Hello, ${input.name}!` };
  },
};
