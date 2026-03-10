/* src/server/core/typescript/__tests__/serialize.test.ts */

import { describe, expect, it } from 'vitest'
import { serialize } from '../src/http.js'

describe('serialize', () => {
	it('passes through strings', () => {
		expect(serialize('hello')).toBe('hello')
	})

	it('serializes objects to JSON', () => {
		expect(serialize({ a: 1 })).toBe('{"a":1}')
	})

	it('serializes arrays to JSON', () => {
		expect(serialize([1, 2, 3])).toBe('[1,2,3]')
	})

	it('serializes null to JSON', () => {
		expect(serialize(null)).toBe('null')
	})

	it('serializes numbers to JSON', () => {
		expect(serialize(42)).toBe('42')
	})

	it('serializes boolean to JSON', () => {
		expect(serialize(true)).toBe('true')
	})

	it('passes through Uint8Array bodies for responses', () => {
		const bytes = Uint8Array.from([1, 2, 3])
		expect(serialize(bytes)).toBe(bytes)
	})

	it('normalizes ArrayBuffer views to Uint8Array', () => {
		const bytes = Buffer.from('<svg/>')
		const body = serialize(bytes)
		expect(body).toBeInstanceOf(Uint8Array)
		expect(Array.from(body as Uint8Array)).toEqual(Array.from(bytes))
	})
})
