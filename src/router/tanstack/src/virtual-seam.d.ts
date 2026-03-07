/* src/router/tanstack/src/virtual-seam.d.ts */

// Ambient declarations for virtual:seam/* (resolved by Vite plugin at runtime).
// This stub enables tsc to build the package; users get types from .seam/generated/seam.d.ts.

declare module 'virtual:seam/routes' {
	import type { SeamRouteDef } from './types'
	const routes: SeamRouteDef[]
	export default routes
}

declare module 'virtual:seam/meta' {
	export const DATA_ID: string
}
