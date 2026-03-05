/* src/server/core/typescript/__tests__/transport.test.ts */

import { describe, test, expect } from 'vitest'
import { createRouter, t, createChannel } from '../src/index.js'
import type { TransportConfig } from '../src/index.js'

describe('transport declaration', () => {
	test('procedure transport appears in manifest', () => {
		const transport: TransportConfig = { prefer: 'ws' }
		const router = createRouter({
			live: {
				kind: 'subscription',
				input: t.object({}),
				output: t.object({}),
				transport,
				handler: async function* () {},
			},
		})
		const manifest = router.manifest()
		expect(manifest.procedures.live.transport).toEqual({ prefer: 'ws' })
	})

	test('no transport omits field', () => {
		const router = createRouter({
			getUser: {
				input: t.object({}),
				output: t.object({}),
				handler: () => ({}),
			},
		})
		const manifest = router.manifest()
		expect(manifest.procedures.getUser.transport).toBeUndefined()
	})

	test('transportDefaults from RouterOptions', () => {
		const router = createRouter(
			{
				getUser: {
					input: t.object({}),
					output: t.object({}),
					handler: () => ({}),
				},
			},
			{
				transportDefaults: {
					query: { prefer: 'http' },
					subscription: { prefer: 'ws', fallback: ['sse', 'http'] },
				},
			},
		)
		const manifest = router.manifest()
		expect(manifest.transportDefaults).toEqual({
			query: { prefer: 'http' },
			subscription: { prefer: 'ws', fallback: ['sse', 'http'] },
		})
	})

	test('channel transport in channelMeta', () => {
		const ch = createChannel('chat', {
			input: t.object({}),
			incoming: {
				send: {
					input: t.object({}),
					output: t.object({}),
					handler: () => ({}),
				},
			},
			outgoing: {
				message: t.object({}),
			},
			subscribe: async function* () {},
			transport: { prefer: 'ws', fallback: ['http'] },
		})
		expect(ch.channelMeta.transport).toEqual({ prefer: 'ws', fallback: ['http'] })
	})

	test('default transportDefaults is empty', () => {
		const router = createRouter({
			getUser: {
				input: t.object({}),
				output: t.object({}),
				handler: () => ({}),
			},
		})
		const manifest = router.manifest()
		expect(manifest.transportDefaults).toEqual({})
	})
})
