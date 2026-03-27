/* examples/github-dashboard/seam-app/src/client/pages/dashboard-skeleton.tsx */

import { useEffect, useState } from 'react'
import { seamRpc } from '@canmi/seam-client'
import { SeamQueryProvider } from '@canmi/seam-query-react'
import { useSeamData, parseSeamData } from '@canmi/seam-react'
import { DATA_ID } from 'virtual:seam/client'
import { seamProcedureConfig } from 'virtual:seam/client'
import { useDerive } from 'virtual:seam/hooks'
import type { DashboardData } from '@github-dashboard/shared/types.js'
import { ProfileHeader } from '@github-dashboard/shared/components/profile-header.js'
import { StatsBar } from '@github-dashboard/shared/components/stats-bar.js'
import { RepoGrid } from '@github-dashboard/shared/components/repo-grid.js'
import type { RepoStats } from '../derive.js'
import { repoStatsClientRegistry } from '../derive.js'

interface DashboardPageData extends DashboardData, Record<string, unknown> {
	__derived?: {
		repoStats?: RepoStats
	}
}

function DashboardContent() {
	const data = useSeamData<DashboardPageData>()
	const [timing, setTiming] = useState('')
	const repoStats = useDerive<RepoStats>('repoStats', repoStatsClientRegistry)

	useEffect(() => {
		try {
			const raw = parseSeamData(DATA_ID)
			if (
				raw._meta &&
				typeof raw._meta === 'object' &&
				(raw._meta as Record<string, unknown>).timing
			) {
				setTiming((raw._meta as Record<string, unknown>).timing as string)
			}
		} catch {
			// No data script — not a CTR page
		}
	}, [])

	return (
		<div className="min-h-screen bg-surface px-4 py-8">
			<div className="mx-auto max-w-3xl">
				<div className="mb-8">
					<a href="/" className="text-sm text-accent hover:text-accent-hover">
						&larr; Back
					</a>
				</div>

				<ProfileHeader user={data.user} />

				<div className="my-6">
					<StatsBar
						publicRepos={data.user.public_repos}
						followers={data.user.followers}
						following={data.user.following}
						totalStars={repoStats?.totalStars}
					/>
				</div>

				<h2 className="mb-4 text-xl font-semibold text-primary">Top Repositories</h2>
				<RepoGrid repos={data.repos} />

				<footer className="mt-8 border-t border-border pt-4 text-center text-sm text-muted">
					Rendered via SeamJS CTR{timing}
				</footer>
			</div>
		</div>
	)
}

export function DashboardSkeleton() {
	return (
		<SeamQueryProvider rpcFn={seamRpc} config={seamProcedureConfig}>
			<DashboardContent />
		</SeamQueryProvider>
	)
}
