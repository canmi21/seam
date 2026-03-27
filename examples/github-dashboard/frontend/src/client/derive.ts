/* examples/github-dashboard/frontend/src/client/derive.ts */

export interface RepoSummary {
	stargazers_count: number
}

export interface RepoStats {
	totalStars: number
}

export const computeRepoStats = (_user: unknown, repos: RepoSummary[]): RepoStats => ({
	totalStars: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
})

export const repoStatsRouteDerive = {
	sources: ['user', 'repos'],
	fn: computeRepoStats,
	output: {
		properties: {
			totalStars: { type: 'uint32' },
		},
	},
} as const

export const repoStatsClientRegistry = {
	repoStats: {
		sources: ['getUser', 'getUserRepos'],
		fn: computeRepoStats,
	},
} as const
