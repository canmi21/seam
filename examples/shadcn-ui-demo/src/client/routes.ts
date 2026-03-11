/* examples/shadcn-ui-demo/src/client/routes.ts */

import { defineSeamRoutes } from '@canmi/seam-tanstack-router/routes'
import { ShowcasePage } from './pages/showcase-page.js'

export default defineSeamRoutes([
	{
		path: '/',
		component: ShowcasePage,
		loaders: {
			intro: { procedure: 'getShowcaseIntro' },
		},
		mock: {
			intro: {
				title: 'Tailwind CSS v4 + shadcn/ui on Seam CTR',
				subtitle: 'Portal primitives match SSR semantics and hydrate into full interaction.',
			},
		},
		head: { title: 'shadcn/ui Demo | SeamJS' },
	},
])
