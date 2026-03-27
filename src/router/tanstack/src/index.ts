/* src/router/tanstack/src/index.ts */

export { seamHydrate, createSeamApp } from './hydrate.js'
export { createSeamRouter } from './create-router.js'
export { defineSeamRoutes, seamRoute } from './define-routes.js'
export { setupLinkInterception } from './link-interceptor.js'

export type {
	SeamRouteDef,
	SeamRouterOptions,
	HydrateOptions,
	ClientLoaderFn,
	SeamRouterContext,
	SeamInitialData,
	SeamI18nMeta,
} from './types.js'
