/* src/server/core/typescript/src/router/state.ts */

import { contextHasExtracts } from '../context.js'
import { buildManifest } from '../manifest/index.js'
import type { PageDef } from '../page/index.js'
import { RouteMatcher } from '../page/route-matcher.js'
import {
	handleRequest,
	handleSubscription,
	handleStream,
	handleBatchRequest,
	handleUploadRequest,
} from './handler.js'
import { categorizeProcedures } from './categorize.js'
import {
	resolveValidationMode,
	buildStrategies,
	registerI18nQuery,
	collectChannelMeta,
	resolveCtxFor,
	resolveCtxSafe,
	matchAndHandlePage,
} from './helpers.js'
import type { DefinitionMap, RouterOptions, Router } from './index.js'

/** Build all shared state that createRouter methods close over */
export function initRouterState(procedures: DefinitionMap, opts?: RouterOptions) {
	const ctxConfig = opts?.context ?? {}
	const { procedureMap, subscriptionMap, streamMap, uploadMap, kindMap } = categorizeProcedures(
		procedures,
		Object.keys(ctxConfig).length > 0 ? ctxConfig : undefined,
	)
	const shouldValidateInput = resolveValidationMode(opts?.validation?.input)
	const shouldValidateOutput =
		opts?.validateOutput ??
		(typeof process !== 'undefined' && process.env.NODE_ENV !== 'production')
	const pageMatcher = new RouteMatcher<PageDef>()
	const pages = opts?.pages
	if (pages) {
		for (const [pattern, page] of Object.entries(pages)) {
			pageMatcher.add(pattern, page)
		}
	}
	const i18nConfig = opts?.i18n ?? null
	const { strategies, hasUrlPrefix } = buildStrategies(opts)
	if (i18nConfig) registerI18nQuery(procedureMap, i18nConfig)
	const channelsMeta = collectChannelMeta(opts?.channels)
	const hasCtx = contextHasExtracts(ctxConfig)
	return {
		ctxConfig,
		procedureMap,
		subscriptionMap,
		streamMap,
		uploadMap,
		kindMap,
		shouldValidateInput,
		shouldValidateOutput,
		pageMatcher,
		pages,
		i18nConfig,
		strategies,
		hasUrlPrefix,
		channelsMeta,
		hasCtx,
	}
}

/** Build request-response methods: handle, handleBatch, handleUpload */
function buildRpcMethods(
	state: ReturnType<typeof initRouterState>,
): Pick<Router<DefinitionMap>, 'handle' | 'handleBatch' | 'handleUpload'> {
	return {
		async handle(procedureName, body, rawCtx) {
			const { ctx, error } = resolveCtxSafe(
				state.procedureMap,
				procedureName,
				rawCtx,
				state.ctxConfig,
			)
			if (error) return error
			return handleRequest(
				state.procedureMap,
				procedureName,
				body,
				state.shouldValidateInput,
				state.shouldValidateOutput,
				ctx,
			)
		},
		handleBatch(calls, rawCtx) {
			const ctxResolver = rawCtx
				? (name: string) => resolveCtxFor(state.procedureMap, name, rawCtx, state.ctxConfig) ?? {}
				: undefined
			return handleBatchRequest(
				state.procedureMap,
				calls,
				state.shouldValidateInput,
				state.shouldValidateOutput,
				ctxResolver,
			)
		},
		async handleUpload(name, body, file, rawCtx) {
			const { ctx, error } = resolveCtxSafe(state.uploadMap, name, rawCtx, state.ctxConfig)
			if (error) return error
			return handleUploadRequest(
				state.uploadMap,
				name,
				body,
				file,
				state.shouldValidateInput,
				state.shouldValidateOutput,
				ctx,
			)
		},
	}
}

/** Build all Router method implementations from shared state */
export function buildRouterMethods(
	state: ReturnType<typeof initRouterState>,
	procedures: DefinitionMap,
	opts?: RouterOptions,
): Omit<Router<DefinitionMap>, 'procedures' | 'rpcHashMap'> {
	return {
		hasPages: !!state.pages && Object.keys(state.pages).length > 0,
		ctxConfig: state.ctxConfig,
		hasContext() {
			return state.hasCtx
		},
		manifest() {
			return buildManifest(procedures, state.channelsMeta, state.ctxConfig, opts?.transportDefaults)
		},
		...buildRpcMethods(state),
		handleSubscription(name, input, rawCtx, lastEventId) {
			const ctx = resolveCtxFor(state.subscriptionMap, name, rawCtx, state.ctxConfig)
			return handleSubscription(
				state.subscriptionMap,
				name,
				input,
				state.shouldValidateInput,
				state.shouldValidateOutput,
				ctx,
				lastEventId,
			)
		},
		handleStream(name, input, rawCtx) {
			const ctx = resolveCtxFor(state.streamMap, name, rawCtx, state.ctxConfig)
			return handleStream(
				state.streamMap,
				name,
				input,
				state.shouldValidateInput,
				state.shouldValidateOutput,
				ctx,
			)
		},
		getKind(name) {
			return state.kindMap.get(name) ?? null
		},
		handlePage(path, headers, rawCtx) {
			return matchAndHandlePage(
				state.pageMatcher,
				state.procedureMap,
				state.i18nConfig,
				state.strategies,
				state.hasUrlPrefix,
				path,
				headers,
				rawCtx,
				state.ctxConfig,
				state.shouldValidateInput,
			)
		},
	}
}
