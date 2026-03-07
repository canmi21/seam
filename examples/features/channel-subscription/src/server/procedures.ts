/* examples/features/channel-subscription/src/server/procedures.ts */

import { t } from '@canmi/seam-server'
import type { QueryDef, SubscriptionDef } from '@canmi/seam-server'

export const getInfo: QueryDef<Record<string, never>, { title: string }> = {
	input: t.object({}),
	output: t.object({ title: t.string() }),
	handler: () => ({ title: 'Channel & Subscription Demo' }),
}

async function* tickStream(interval: number): AsyncGenerator<{ tick: number }> {
	for (let i = 1; i <= 5; i++) {
		await new Promise((r) => {
			setTimeout(r, interval)
		})
		yield { tick: i }
	}
}

export const onTick: SubscriptionDef<{ interval: number }, { tick: number }> = {
	kind: 'subscription',
	input: t.object({ interval: t.int32() }),
	output: t.object({ tick: t.int32() }),
	handler: ({ input }) => tickStream(input.interval),
}
