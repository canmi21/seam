/* demo/backend/typescript/src/procedures/get-user.ts */

import { t, SeamError } from "@canmi/seam-server";
import type { ProcedureDef } from "@canmi/seam-server";

interface GetUserInput {
  id: number;
}

interface GetUserOutput {
  id: number;
  name: string;
  email: string;
  avatar?: string | null;
}

const USERS: GetUserOutput[] = [
  { id: 1, name: "Alice", email: "alice@example.com", avatar: "https://example.com/alice.png" },
  { id: 2, name: "Bob", email: "bob@example.com", avatar: null },
  { id: 3, name: "Charlie", email: "charlie@example.com" },
];

export const getUser: ProcedureDef<GetUserInput, GetUserOutput> = {
  input: t.object({ id: t.uint32() }),
  output: t.object({
    id: t.uint32(),
    name: t.string(),
    email: t.string(),
    avatar: t.optional(t.nullable(t.string())),
  }),
  handler: ({ input }) => {
    const user = USERS.find((u) => u.id === input.id);
    if (!user) {
      throw new SeamError("NOT_FOUND", `User ${input.id} not found`);
    }
    return user;
  },
};
