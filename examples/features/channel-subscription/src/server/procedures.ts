/* examples/features/channel-subscription/src/server/procedures.ts */

import { t, query, subscription } from '@canmi/seam-server'

export const getInfo = query({
	input: t.object({}),
	output: t.object({ title: t.string() }),
	handler: () => ({ title: 'Channel & Subscription Demo' }),
})

async function* tickStream(interval: number): AsyncGenerator<{ tick: number }> {
	for (let i = 1; i <= 5; i++) {
		await new Promise((r) => {
			setTimeout(r, interval)
		})
		yield { tick: i }
	}
}

export const onTick = subscription({
	input: t.object({ interval: t.int32() }),
	output: t.object({ tick: t.int32() }),
	handler: ({ input }) => tickStream(input.interval),
})

async function* longTickStream(): AsyncGenerator<{ tick: number; ts: number }> {
	for (let i = 1; i <= 100; i++) {
		await new Promise((r) => {
			setTimeout(r, 300)
		})
		yield { tick: i, ts: Date.now() }
	}
}

export const onLongTick = subscription({
	input: t.object({}),
	output: t.object({ tick: t.int32(), ts: t.float64() }),
	handler: () => longTickStream(),
})
