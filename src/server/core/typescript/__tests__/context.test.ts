/* src/server/core/typescript/__tests__/context.test.ts */

import { describe, expect, it } from 'vitest'
import { parseExtractRule, contextExtractKeys, resolveContext } from '../src/context.js'
import type { ContextConfig } from '../src/context.js'
import { t } from '../src/types/index.js'
import { SeamError } from '../src/errors.js'

describe('parseExtractRule', () => {
	it('parses header rule', () => {
		expect(parseExtractRule('header:authorization')).toEqual({
			source: 'header',
			key: 'authorization',
		})
	})

	it('parses cookie rule', () => {
		expect(parseExtractRule('cookie:session_id')).toEqual({
			source: 'cookie',
			key: 'session_id',
		})
	})

	it('throws on missing colon', () => {
		expect(() => parseExtractRule('invalid')).toThrow('expected "source:key" format')
	})

	it('throws on empty source', () => {
		expect(() => parseExtractRule(':value')).toThrow('source and key must be non-empty')
	})

	it('throws on empty key', () => {
		expect(() => parseExtractRule('header:')).toThrow('source and key must be non-empty')
	})
})

describe('contextExtractKeys', () => {
	it('collects unique header names', () => {
		const config: ContextConfig = {
			auth: { extract: 'header:authorization', schema: t.string() },
			requestId: { extract: 'header:x-request-id', schema: t.string() },
		}
		expect(contextExtractKeys(config)).toEqual(['authorization', 'x-request-id'])
	})

	it('deduplicates same header', () => {
		const config: ContextConfig = {
			auth: { extract: 'header:authorization', schema: t.string() },
			authCopy: { extract: 'header:authorization', schema: t.string() },
		}
		expect(contextExtractKeys(config)).toEqual(['authorization'])
	})

	it('returns empty for no config', () => {
		expect(contextExtractKeys({})).toEqual([])
	})
})

describe('resolveContext', () => {
	const config: ContextConfig = {
		auth: { extract: 'header:authorization', schema: t.string() },
		userId: { extract: 'header:x-user-id', schema: t.nullable(t.string()) },
	}

	it('resolves string value from header', () => {
		const result = resolveContext(config, { authorization: 'Bearer tok123' }, ['auth'])
		expect(result).toEqual({ auth: 'Bearer tok123' })
	})

	it('resolves only requested keys', () => {
		const result = resolveContext(config, { authorization: 'Bearer tok', 'x-user-id': 'u1' }, [
			'auth',
		])
		expect(result).toEqual({ auth: 'Bearer tok' })
		expect(result).not.toHaveProperty('userId')
	})

	it('passes null for missing header with nullable schema', () => {
		const result = resolveContext(config, { authorization: 'tok' }, ['userId'])
		expect(result).toEqual({ userId: null })
	})

	it('throws CONTEXT_ERROR for missing header with non-nullable schema', () => {
		try {
			resolveContext(config, {}, ['auth'])
			expect.unreachable('should have thrown')
		} catch (err) {
			expect(err).toBeInstanceOf(SeamError)
			expect((err as SeamError).code).toBe('CONTEXT_ERROR')
			expect((err as SeamError).status).toBe(400)
		}
	})

	it('throws on undefined context field', () => {
		try {
			resolveContext(config, {}, ['nonexistent'])
			expect.unreachable('should have thrown')
		} catch (err) {
			expect(err).toBeInstanceOf(SeamError)
			expect((err as SeamError).message).toContain('not defined')
		}
	})

	it('resolves JSON object from header', () => {
		const objConfig: ContextConfig = {
			meta: {
				extract: 'header:x-meta',
				schema: t.object({ role: t.string() }),
			},
		}
		const result = resolveContext(objConfig, { 'x-meta': '{"role":"admin"}' }, ['meta'])
		expect(result).toEqual({ meta: { role: 'admin' } })
	})

	it('throws on invalid JSON for object schema', () => {
		const objConfig: ContextConfig = {
			meta: {
				extract: 'header:x-meta',
				schema: t.object({ role: t.string() }),
			},
		}
		try {
			resolveContext(objConfig, { 'x-meta': 'not-json' }, ['meta'])
			expect.unreachable('should have thrown')
		} catch (err) {
			expect(err).toBeInstanceOf(SeamError)
			expect((err as SeamError).message).toContain('failed to parse value as JSON')
		}
	})

	it('throws on schema validation failure for parsed JSON', () => {
		const objConfig: ContextConfig = {
			meta: {
				extract: 'header:x-meta',
				schema: t.object({ role: t.string() }),
			},
		}
		try {
			resolveContext(objConfig, { 'x-meta': '{"role": 42}' }, ['meta'])
			expect.unreachable('should have thrown')
		} catch (err) {
			expect(err).toBeInstanceOf(SeamError)
			expect((err as SeamError).message).toContain('validation failed')
		}
	})

	it('returns empty object for empty requestedKeys', () => {
		const result = resolveContext(config, { authorization: 'tok' }, [])
		expect(result).toEqual({})
	})
})
