/* examples/features/context-auth/src/server/procedures.ts */

import { t } from '@canmi/seam-server'
import type { ProcedureDef, CommandDef } from '@canmi/seam-server'

export const getPublicInfo: ProcedureDef<Record<string, never>, { message: string }> = {
	input: t.object({}),
	output: t.object({ message: t.string() }),
	handler: () => ({ message: 'This is public' }),
}

export const getSecretData: ProcedureDef<Record<string, never>, { message: string }> = {
	input: t.object({}),
	output: t.object({ message: t.string() }),
	context: ['auth'],
	handler: ({ ctx }) => {
		const auth = ctx.auth as { userId: string; role: string }
		return { message: `Hello ${auth.userId}, your role is ${auth.role}` }
	},
}

export const updateProfile: CommandDef<{ name: string }, { ok: boolean; updatedBy: string }> = {
	kind: 'command',
	input: t.object({ name: t.string() }),
	output: t.object({ ok: t.boolean(), updatedBy: t.string() }),
	context: ['auth'],
	handler: ({ ctx }) => {
		const auth = ctx.auth as { userId: string; role: string }
		return { ok: true, updatedBy: auth.userId }
	},
}
