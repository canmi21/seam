/* examples/features/handoff-narrowing/src/server/procedures.ts */

import { t } from '@canmi/seam-server'
import type { ProcedureDef } from '@canmi/seam-server'

export const getUserProfile: ProcedureDef = {
	input: t.object({}),
	output: t.object({
		name: t.string(),
		email: t.string(),
		avatar: t.string(),
		bio: t.string(),
		createdAt: t.string(),
		settings: t.object({
			theme: t.string(),
			lang: t.string(),
		}),
	}),
	handler: () => ({
		name: 'Alice Chen',
		email: 'alice@example.com',
		avatar: 'https://i.pravatar.cc/80?u=alice',
		bio: 'Full-stack developer who loves building tools.',
		createdAt: '2024-01-15T00:00:00Z',
		settings: { theme: 'dark', lang: 'en' },
	}),
}

export const getUserTheme: ProcedureDef = {
	input: t.object({}),
	output: t.object({ mode: t.string() }),
	handler: () => ({ mode: 'light' }),
}
