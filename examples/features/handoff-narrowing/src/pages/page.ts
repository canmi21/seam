/* examples/features/handoff-narrowing/src/pages/page.ts */

export const loaders = {
	profile: { procedure: 'getUserProfile' },
	theme: { procedure: 'getUserTheme', handoff: 'client' },
}

export const mock = {
	profile: {
		name: 'Alice Chen',
		email: 'alice@example.com',
		avatar: 'https://i.pravatar.cc/80?u=alice',
		bio: 'Full-stack developer who loves building tools.',
		createdAt: '2024-01-15T00:00:00Z',
		settings: { theme: 'dark', lang: 'en' },
	},
	theme: { mode: 'light' },
}
