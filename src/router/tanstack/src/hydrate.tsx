/* src/router/tanstack/src/hydrate.tsx */

import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { createSeamRouter } from './create-router.js'
import { setupLinkInterception } from './link-interceptor.js'
import type { HydrateOptions } from './types.js'

export async function seamHydrate(opts: HydrateOptions) {
	const { root, strict = true, ...routerOpts } = opts

	if (!routerOpts.routes) {
		const mod = await import('virtual:seam/routes')
		routerOpts.routes = mod.default
	}

	const router = createSeamRouter(routerOpts)

	setupLinkInterception(router)

	// SSR hack prevents RouterProvider from calling router.load() automatically,
	// so we must load before hydration to populate route matches.
	await router.load()

	const app = <RouterProvider router={router} />

	hydrateRoot(root, strict ? <StrictMode>{app}</StrictMode> : app)

	return router
}

export async function createSeamApp(opts?: Partial<HydrateOptions>) {
	const root = opts?.root ?? document.getElementById('__seam')
	if (!root) throw new Error('Missing #__seam element')
	return seamHydrate({ ...opts, root } as HydrateOptions)
}
