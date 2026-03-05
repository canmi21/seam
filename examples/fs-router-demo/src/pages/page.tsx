/* examples/fs-router-demo/src/pages/page.tsx */

import { useSeamData } from '@canmi/seam-react'

interface HomeData extends Record<string, unknown> {
	home: { title: string; description: string }
}

export default function HomePage() {
	const data = useSeamData<HomeData>()
	return (
		<div>
			<h1>{data.home.title}</h1>
			<p>{data.home.description}</p>
		</div>
	)
}
