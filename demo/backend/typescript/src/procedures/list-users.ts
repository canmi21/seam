import { t } from "@canmi/seam-server";
import type { ProcedureDef } from "@canmi/seam-server";

interface UserSummary {
  id: number;
  name: string;
}

const USERS: UserSummary[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Charlie" },
];

export const listUsers: ProcedureDef<Record<string, never>, UserSummary[]> = {
  input: t.object({}),
  output: t.array(t.object({ id: t.uint32(), name: t.string() })),
  handler: () => {
    return USERS;
  },
};
