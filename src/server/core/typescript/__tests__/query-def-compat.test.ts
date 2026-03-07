/* src/server/core/typescript/__tests__/query-def-compat.test.ts */

import { describe, it, expect } from 'vitest'
import type { ProcedureDef, QueryDef, DefinitionMap } from '../src/index.js'
import { t, createRouter } from '../src/index.js'

describe('QueryDef backward compatibility', () => {
	it('ProcedureDef and QueryDef are interchangeable', () => {
		const asProcedureDef: ProcedureDef<{ id: string }, { name: string }> = {
			input: t.object({ id: t.string() }),
			output: t.object({ name: t.string() }),
			handler: ({ input }) => ({ name: input.id }),
		}
		const asQueryDef: QueryDef<{ id: string }, { name: string }> = asProcedureDef
		expect(asQueryDef).toBe(asProcedureDef)
	})

	it('DefinitionMap accepts QueryDef values', () => {
		const defs: DefinitionMap = {
			getUser: {
				input: t.object({ id: t.string() }),
				output: t.object({ name: t.string() }),
				handler: ({ input }) => ({ name: (input as { id: string }).id }),
			} satisfies QueryDef,
		}
		const router = createRouter(defs)
		expect(router.manifest().procedures).toHaveProperty('getUser')
	})

	it('DefinitionMap still accepts ProcedureDef values', () => {
		const defs: DefinitionMap = {
			getUser: {
				input: t.object({ id: t.string() }),
				output: t.object({ name: t.string() }),
				handler: ({ input }) => ({ name: (input as { id: string }).id }),
			} satisfies ProcedureDef,
		}
		const router = createRouter(defs)
		expect(router.manifest().procedures).toHaveProperty('getUser')
	})
})
