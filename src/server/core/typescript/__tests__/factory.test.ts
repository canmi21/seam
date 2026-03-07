/* src/server/core/typescript/__tests__/factory.test.ts */

import { describe, expect, it } from 'vitest'
import { query, command, subscription, stream, upload } from '../src/factory.js'
import { createRouter } from '../src/router/index.js'
import { t } from '../src/types/index.js'

describe('factory functions', () => {
	it('query injects kind and preserves properties', () => {
		const def = query({
			input: t.object({ id: t.string() }),
			output: t.object({ name: t.string() }),
			cache: { ttl: 30 },
			handler: ({ input }) => ({ name: input.id }),
		})
		expect(def.kind).toBe('query')
		expect(def.cache).toEqual({ ttl: 30 })
	})

	it('command injects kind and preserves invalidates', () => {
		const def = command({
			input: t.object({ id: t.string() }),
			output: t.object({ ok: t.boolean() }),
			invalidates: ['listItems'],
			handler: () => ({ ok: true }),
		})
		expect(def.kind).toBe('command')
		expect(def.invalidates).toEqual(['listItems'])
	})

	it('subscription injects kind', () => {
		async function* gen() {
			yield { n: 1 }
		}
		const def = subscription({
			input: t.object({}),
			output: t.object({ n: t.int32() }),
			handler: () => gen(),
		})
		expect(def.kind).toBe('subscription')
	})

	it('stream injects kind', () => {
		const def = stream({
			input: t.object({}),
			output: t.object({ n: t.int32() }),
			async *handler() {
				yield { n: 1 }
			},
		})
		expect(def.kind).toBe('stream')
	})

	it('upload injects kind', () => {
		const def = upload({
			input: t.object({ name: t.string() }),
			output: t.object({ size: t.int32() }),
			handler: () => ({ size: 0 }),
		})
		expect(def.kind).toBe('upload')
	})

	it('factory output works with createRouter', () => {
		const router = createRouter({
			getItem: query({
				input: t.object({ id: t.string() }),
				output: t.object({ name: t.string() }),
				handler: ({ input }) => ({ name: input.id }),
			}),
			addItem: command({
				input: t.object({ name: t.string() }),
				output: t.object({ ok: t.boolean() }),
				invalidates: ['getItem'],
				handler: () => ({ ok: true }),
			}),
		})
		const manifest = router.manifest()
		expect(manifest.procedures.getItem.kind).toBe('query')
		expect(manifest.procedures.addItem.kind).toBe('command')
	})
})

describe('factory type-level checks', () => {
	it('query rejects invalidates', () => {
		query({
			input: t.object({}),
			output: t.object({}),
			// @ts-expect-error invalidates is not on QueryDef
			invalidates: ['foo'],
			handler: () => ({}),
		})
	})

	it('query rejects kind', () => {
		query({
			input: t.object({}),
			output: t.object({}),
			// @ts-expect-error kind is omitted by factory
			kind: 'query',
			handler: () => ({}),
		})
	})

	it('command accepts invalidates', () => {
		// No @ts-expect-error — this should compile fine
		command({
			input: t.object({}),
			output: t.object({}),
			invalidates: ['foo'],
			handler: () => ({}),
		})
	})
})
