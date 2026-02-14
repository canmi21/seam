/* examples/standalone/server-bun/src/subscriptions/on-count.ts */

import { t } from "@canmi/seam-server";
import type { SubscriptionDef } from "@canmi/seam-server";

async function* countStream(max: number): AsyncGenerator<{ n: number }> {
  for (let i = 1; i <= max; i++) {
    yield { n: i };
  }
}

export const onCount: SubscriptionDef<{ max: number }, { n: number }> = {
  type: "subscription",
  input: t.object({ max: t.int32() }),
  output: t.object({ n: t.int32() }),
  handler: ({ input }) => countStream(input.max),
};
