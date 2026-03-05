/* examples/features/handoff-narrowing/src/pages/page.tsx */

import { useState } from 'react'
import { useSeamData, useSeamHandoff } from '@canmi/seam-react'

interface PageData extends Record<string, unknown> {
	profile: {
		name: string
		avatar: string
		// Schema narrowing: only name and avatar are read in the skeleton,
		// so other fields (email, bio, createdAt, settings) are pruned at build time.
	}
	theme: {
		mode: string
	}
}

export default function ProfilePage() {
	const data = useSeamData<PageData>()
	const handoffKeys = useSeamHandoff()
	const isThemeHandoff = handoffKeys.includes('theme')

	// After hydration, client manages theme state independently
	const [mode, setMode] = useState(data.theme.mode)

	function toggleTheme() {
		setMode((prev) => (prev === 'light' ? 'dark' : 'light'))
	}

	return (
		<div>
			<h1>Handoff & Narrowing Demo</h1>

			<h2>User Profile (narrowed)</h2>
			<div>
				<img src={data.profile.avatar} alt={data.profile.name} width={80} height={80} />
				<p>{data.profile.name}</p>
			</div>

			<h2>Theme (handoff: client)</h2>
			<p>
				Current mode: <strong>{mode}</strong>
			</p>
			<button type="button" onClick={toggleTheme}>
				Toggle Theme
			</button>
			<p>
				Handoff keys: [{handoffKeys.join(', ')}]
				{isThemeHandoff && ' — theme is managed by client after hydration'}
			</p>
		</div>
	)
}
