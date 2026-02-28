/* examples/standalone/server-bun/src/procedures/update-email.ts */

import { t, SeamError } from "@canmi/seam-server";
import type { CommandDef } from "@canmi/seam-server";

interface UpdateEmailInput {
  userId: number;
  newEmail: string;
}

interface UpdateEmailOutput {
  success: boolean;
}

export const updateEmail: CommandDef<UpdateEmailInput, UpdateEmailOutput> = {
  type: "command",
  input: t.object({ userId: t.uint32(), newEmail: t.string() }),
  output: t.object({ success: t.boolean() }),
  handler: ({ input }) => {
    if (input.userId > 3) {
      throw new SeamError("NOT_FOUND", `User ${input.userId} not found`);
    }
    return { success: true };
  },
};
