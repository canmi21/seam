/* examples/features/context-auth/src/server/procedures.ts */

import { t, query, command } from '@canmi/seam-server'

export const getPublicInfo = query({
	input: t.object({}),
	output: t.object({ message: t.string() }),
	handler: () => ({ message: 'This is public' }),
})

export const getSecretData = query({
	input: t.object({}),
	output: t.object({ message: t.string() }),
	context: ['auth'],
	handler: ({ ctx }) => {
		const auth = ctx.auth as { userId: string; role: string }
		return { message: `Hello ${auth.userId}, your role is ${auth.role}` }
	},
})

export const updateProfile = command({
	input: t.object({ name: t.string() }),
	output: t.object({ ok: t.boolean(), updatedBy: t.string() }),
	context: ['auth'],
	handler: ({ ctx }) => {
		const auth = ctx.auth as { userId: string; role: string }
		return { ok: true, updatedBy: auth.userId }
	},
})
