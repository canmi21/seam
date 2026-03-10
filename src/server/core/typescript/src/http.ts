/* src/server/core/typescript/src/http.ts */

import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import type { Router, DefinitionMap } from './router/index.js'
import type { RawContextMap } from './context.js'
import { buildRawContext } from './context.js'
import type { SeamFileHandle } from './procedure.js'
import { SeamError } from './errors.js'
import { MIME_TYPES } from './mime.js'
import { watchReloadTrigger } from './dev/index.js'
import { loadBuildDev } from './page/build-loader.js'

export interface HttpRequest {
	method: string
	url: string
	body: () => Promise<unknown>
	header?: (name: string) => string | null
	file?: () => Promise<SeamFileHandle | null>
}

export interface HttpBodyResponse {
	status: number
	headers: Record<string, string>
	body: unknown
}

export interface HttpStreamResponse {
	status: number
	headers: Record<string, string>
	stream: AsyncIterable<string>
	onCancel?: () => void
}

export type HttpResponse = HttpBodyResponse | HttpStreamResponse

export type HttpHandler = (req: HttpRequest) => Promise<HttpResponse>

export interface RpcHashMap {
	procedures: Record<string, string>
	batch: string
}

export interface SseOptions {
	heartbeatInterval?: number // ms, default 21_000
	sseIdleTimeout?: number // ms, default 30_000, 0 disables
}

export interface HttpHandlerOptions {
	staticDir?: string
	publicDir?: string
	fallback?: HttpHandler
	rpcHashMap?: RpcHashMap
	sseOptions?: SseOptions
	/** Build directory for dev reload. Auto-detected from SEAM_OUTPUT_DIR when omitted. */
	devBuildDir?: string
}

const PROCEDURE_PREFIX = '/_seam/procedure/'
const PAGE_PREFIX = '/_seam/page/'
const DATA_PREFIX = '/_seam/data/'
const STATIC_PREFIX = '/_seam/static/'
const MANIFEST_PATH = '/_seam/manifest.json'
const DEV_RELOAD_PATH = '/_seam/dev/reload'

const JSON_HEADER = { 'Content-Type': 'application/json' }
const HTML_HEADER = { 'Content-Type': 'text/html; charset=utf-8' }
const SSE_HEADER = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache',
	Connection: 'keep-alive',
}
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
const PUBLIC_CACHE = 'public, max-age=3600'

function jsonResponse(status: number, body: unknown): HttpBodyResponse {
	return { status, headers: JSON_HEADER, body }
}

function errorResponse(status: number, code: string, message: string): HttpBodyResponse {
	return jsonResponse(status, new SeamError(code, message).toJSON())
}

async function handleStaticAsset(assetPath: string, staticDir: string): Promise<HttpBodyResponse> {
	if (assetPath.includes('..')) {
		return errorResponse(403, 'VALIDATION_ERROR', 'Forbidden')
	}

	const filePath = join(staticDir, assetPath)
	try {
		const content = await readFile(filePath, 'utf-8')
		const ext = extname(filePath)
		const contentType = MIME_TYPES[ext] || 'application/octet-stream'
		return {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Cache-Control': IMMUTABLE_CACHE,
			},
			body: content,
		}
	} catch {
		return errorResponse(404, 'NOT_FOUND', 'Asset not found')
	}
}

async function handlePublicFile(
	pathname: string,
	publicDir: string,
): Promise<HttpBodyResponse | null> {
	if (pathname.includes('..')) return null
	const filePath = join(publicDir, pathname)
	try {
		const content = await readFile(filePath)
		const ext = extname(filePath)
		const contentType = MIME_TYPES[ext] || 'application/octet-stream'
		return {
			status: 200,
			headers: { 'Content-Type': contentType, 'Cache-Control': PUBLIC_CACHE },
			body: content,
		}
	} catch {
		return null
	}
}

function getPageRequestHeaders(req: HttpRequest): {
	url: string
	cookie?: string
	acceptLanguage?: string
} | undefined {
	if (!req.header) return undefined
	return {
		url: req.url,
		cookie: req.header('cookie') ?? undefined,
		acceptLanguage: req.header('accept-language') ?? undefined,
	}
}

/** Format a single SSE data event */
export function sseDataEvent(data: unknown): string {
	return `event: data\ndata: ${JSON.stringify(data)}\n\n`
}

/** Format an SSE data event with a sequence id (for streams) */
export function sseDataEventWithId(data: unknown, id: number): string {
	return `event: data\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`
}

/** Format an SSE error event */
export function sseErrorEvent(code: string, message: string, transient = false): string {
	return `event: error\ndata: ${JSON.stringify({ code, message, transient })}\n\n`
}

/** Format an SSE complete event */
export function sseCompleteEvent(): string {
	return 'event: complete\ndata: {}\n\n'
}

function formatSseError(error: unknown): string {
	if (error instanceof SeamError) {
		return sseErrorEvent(error.code, error.message)
	}
	const message = error instanceof Error ? error.message : 'Unknown error'
	return sseErrorEvent('INTERNAL_ERROR', message)
}

const DEFAULT_HEARTBEAT_MS = 21_000
const DEFAULT_SSE_IDLE_MS = 30_000

async function* withSseLifecycle(
	inner: AsyncIterable<string>,
	opts?: SseOptions,
): AsyncGenerator<string> {
	const heartbeatMs = opts?.heartbeatInterval ?? DEFAULT_HEARTBEAT_MS
	const idleMs = opts?.sseIdleTimeout ?? DEFAULT_SSE_IDLE_MS
	const idleEnabled = idleMs > 0

	// Queue-based approach: background drains inner generator
	const queue: Array<
		{ type: 'data'; value: string } | { type: 'done' } | { type: 'heartbeat' } | { type: 'idle' }
	> = []
	let resolve: (() => void) | null = null
	const signal = () => {
		if (resolve) {
			resolve()
			resolve = null
		}
	}

	let idleTimer: ReturnType<typeof setTimeout> | null = null
	const resetIdle = () => {
		if (!idleEnabled) return
		if (idleTimer) clearTimeout(idleTimer)
		idleTimer = setTimeout(() => {
			queue.push({ type: 'idle' })
			signal()
		}, idleMs)
	}

	const heartbeatTimer = setInterval(() => {
		queue.push({ type: 'heartbeat' })
		signal()
	}, heartbeatMs)

	// Start idle timer
	resetIdle()

	// Background: drain inner generator
	void (async () => {
		try {
			for await (const chunk of inner) {
				queue.push({ type: 'data', value: chunk })
				resetIdle()
				signal()
			}
		} catch {
			// Inner generator error
		}
		queue.push({ type: 'done' })
		signal()
	})()

	try {
		for (;;) {
			while (queue.length === 0) {
				await new Promise<void>((r) => {
					resolve = r
				})
			}
			const item = queue.shift()
			if (!item) continue
			if (item.type === 'data') {
				yield item.value
			} else if (item.type === 'heartbeat') {
				yield ': heartbeat\n\n'
			} else if (item.type === 'idle') {
				yield sseCompleteEvent()
				return
			} else {
				// done
				return
			}
		}
	} finally {
		clearInterval(heartbeatTimer)
		if (idleTimer) clearTimeout(idleTimer)
	}
}

async function* sseStream<T extends DefinitionMap>(
	router: Router<T>,
	name: string,
	input: unknown,
	rawCtx?: RawContextMap,
	lastEventId?: string,
): AsyncIterable<string> {
	try {
		let seq = 0
		for await (const value of router.handleSubscription(name, input, rawCtx, lastEventId)) {
			yield sseDataEventWithId(value, seq++)
		}
		yield sseCompleteEvent()
	} catch (error) {
		yield formatSseError(error)
	}
}

async function* sseStreamForStream<T extends DefinitionMap>(
	router: Router<T>,
	name: string,
	input: unknown,
	signal?: AbortSignal,
	rawCtx?: RawContextMap,
): AsyncGenerator<string> {
	const gen = router.handleStream(name, input, rawCtx)
	// Wire abort signal to terminate the generator
	if (signal) {
		signal.addEventListener(
			'abort',
			() => {
				void gen.return(undefined)
			},
			{ once: true },
		)
	}
	try {
		let seq = 0
		for await (const value of gen) {
			yield sseDataEventWithId(value, seq++)
		}
		yield sseCompleteEvent()
	} catch (error) {
		yield formatSseError(error)
	}
}

async function handleBatchHttp<T extends DefinitionMap>(
	req: HttpRequest,
	router: Router<T>,
	hashToName: Map<string, string> | null,
	rawCtx?: RawContextMap,
): Promise<HttpBodyResponse> {
	let body: unknown
	try {
		body = await req.body()
	} catch {
		return errorResponse(400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}
	if (!body || typeof body !== 'object' || !Array.isArray((body as { calls?: unknown }).calls)) {
		return errorResponse(400, 'VALIDATION_ERROR', "Batch request must have a 'calls' array")
	}
	const calls = (body as { calls: Array<{ procedure?: unknown; input?: unknown }> }).calls.map(
		(c) => ({
			procedure:
				typeof c.procedure === 'string' ? (hashToName?.get(c.procedure) ?? c.procedure) : '',
			input: c.input ?? {},
		}),
	)
	const result = await router.handleBatch(calls, rawCtx)
	return jsonResponse(200, { ok: true, data: result })
}

/** Resolve hash -> original name when obfuscation is active. Accepts both hashed and raw names. */
function resolveHashName(hashToName: Map<string, string> | null, name: string): string {
	if (!hashToName) return name
	return hashToName.get(name) ?? name
}

async function handleProcedurePost<T extends DefinitionMap>(
	req: HttpRequest,
	router: Router<T>,
	name: string,
	rawCtx?: RawContextMap,
	sseOptions?: SseOptions,
): Promise<HttpResponse> {
	let body: unknown
	try {
		body = await req.body()
	} catch {
		return errorResponse(400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	if (router.getKind(name) === 'stream') {
		const controller = new AbortController()
		return {
			status: 200,
			headers: SSE_HEADER,
			stream: withSseLifecycle(
				sseStreamForStream(router, name, body, controller.signal, rawCtx),
				sseOptions,
			),
			onCancel: () => controller.abort(),
		}
	}

	if (router.getKind(name) === 'upload') {
		if (!req.file) {
			return errorResponse(400, 'VALIDATION_ERROR', 'Upload requires multipart/form-data')
		}
		const file = await req.file()
		if (!file) {
			return errorResponse(400, 'VALIDATION_ERROR', 'Upload requires file in multipart body')
		}
		const result = await router.handleUpload(name, body, file, rawCtx)
		return jsonResponse(result.status, result.body)
	}

	const result = await router.handle(name, body, rawCtx)
	return jsonResponse(result.status, result.body)
}

function buildHashLookup(hashMap: RpcHashMap | undefined): Map<string, string> | null {
	if (!hashMap) return null
	const map = new Map(Object.entries(hashMap.procedures).map(([n, h]) => [h, n]))
	map.set('seam.i18n.query', 'seam.i18n.query')
	return map
}

function createDevReloadResponse(
	devState: { resolvers: Set<() => void> },
	sseOptions?: SseOptions,
): HttpStreamResponse {
	const controller = new AbortController()
	async function* devStream(): AsyncGenerator<string> {
		yield ': connected\n\n'
		const aborted = new Promise<never>((_, reject) => {
			controller.signal.addEventListener('abort', () => reject(new Error('aborted')), {
				once: true,
			})
		})
		try {
			while (!controller.signal.aborted) {
				await Promise.race([
					new Promise<void>((r) => {
						devState.resolvers.add(r)
					}),
					aborted,
				])
				yield 'data: reload\n\n'
			}
		} catch {
			/* aborted */
		}
	}
	return {
		status: 200,
		headers: { ...SSE_HEADER, 'X-Accel-Buffering': 'no' },
		stream: withSseLifecycle(devStream(), { ...sseOptions, sseIdleTimeout: 0 }),
		onCancel: () => controller.abort(),
	}
}

export function createHttpHandler<T extends DefinitionMap>(
	router: Router<T>,
	opts?: HttpHandlerOptions,
): HttpHandler {
	// Explicit option overrides; fall back to router's stored value
	const effectiveHashMap = opts?.rpcHashMap ?? router.rpcHashMap
	const hashToName = buildHashLookup(effectiveHashMap)
	const batchHash = effectiveHashMap?.batch ?? null
	const hasCtx = router.hasContext()

	// Dev-mode live reload: watch .reload-trigger, reload router, notify SSE clients
	const devDir =
		opts?.devBuildDir ??
		(process.env.SEAM_DEV === '1' && process.env.SEAM_VITE !== '1'
			? process.env.SEAM_OUTPUT_DIR
			: undefined)
	const devState: { resolvers: Set<() => void> } | null = devDir
		? { resolvers: new Set() }
		: null
	if (devState && devDir) {
		watchReloadTrigger(devDir, () => {
			try {
				router.reload(loadBuildDev(devDir))
			} catch {
				// Manifest might be mid-write; skip this reload cycle
			}
			const batch = devState.resolvers
			devState.resolvers = new Set()
			for (const r of batch) r()
		})
	}

	return async (req) => {
		const url = new URL(req.url, 'http://localhost')
		const { pathname } = url

		// Build raw context map from request headers/cookies/query when context fields are defined
		const rawCtx: RawContextMap | undefined = hasCtx
			? buildRawContext(router.ctxConfig, req.header, url)
			: undefined

		if (req.method === 'GET' && pathname === MANIFEST_PATH) {
			if (effectiveHashMap) return errorResponse(403, 'FORBIDDEN', 'Manifest disabled')
			return jsonResponse(200, router.manifest())
		}

		if (pathname.startsWith(PROCEDURE_PREFIX)) {
			const rawName = pathname.slice(PROCEDURE_PREFIX.length)
			if (!rawName) {
				return errorResponse(404, 'NOT_FOUND', 'Empty procedure name')
			}

			if (req.method === 'POST') {
				if (rawName === '_batch' || (batchHash && rawName === batchHash)) {
					return handleBatchHttp(req, router, hashToName, rawCtx)
				}
				const name = resolveHashName(hashToName, rawName)
				return handleProcedurePost(req, router, name, rawCtx, opts?.sseOptions)
			}

			if (req.method === 'GET') {
				const name = resolveHashName(hashToName, rawName)

				const rawInput = url.searchParams.get('input')
				let input: unknown
				try {
					input = rawInput ? JSON.parse(rawInput) : {}
				} catch {
					return errorResponse(400, 'VALIDATION_ERROR', 'Invalid input query parameter')
				}

				const lastEventId = req.header?.('last-event-id') ?? undefined
				return {
					status: 200,
					headers: SSE_HEADER,
					stream: withSseLifecycle(
						sseStream(router, name, input, rawCtx, lastEventId),
						opts?.sseOptions,
					),
				}
			}
		}

		// Pages are served under /_seam/page/* prefix only.
		// Root-path serving is the application's responsibility — see the
		// github-dashboard ts-hono example for the fallback pattern.
		if (req.method === 'GET' && pathname.startsWith(PAGE_PREFIX) && router.hasPages) {
			const pagePath = '/' + pathname.slice(PAGE_PREFIX.length)
			const headers = getPageRequestHeaders(req)
			const result = await router.handlePage(pagePath, headers, rawCtx)
			if (result) {
				return { status: result.status, headers: HTML_HEADER, body: result.html }
			}
		}

		// Page data endpoint: serves __data.json for prerendered pages (SPA navigation)
		if (req.method === 'GET' && pathname.startsWith(DATA_PREFIX) && router.hasPages) {
			const pagePath = '/' + pathname.slice(DATA_PREFIX.length).replace(/\/$/, '')
			const dataResult = await router.handlePageData(pagePath)
			if (dataResult !== null) {
				return jsonResponse(200, dataResult)
			}
		}

		if (req.method === 'GET' && pathname.startsWith(STATIC_PREFIX) && opts?.staticDir) {
			const assetPath = pathname.slice(STATIC_PREFIX.length)
			return handleStaticAsset(assetPath, opts.staticDir)
		}

		// Dev-mode live reload SSE endpoint
		if (req.method === 'GET' && pathname === DEV_RELOAD_PATH && devState) {
			return createDevReloadResponse(devState, opts?.sseOptions)
		}

		// Public files at root path (after all /_seam/* routes, before fallback)
		if (req.method === 'GET' && opts?.publicDir) {
			const publicResult = await handlePublicFile(pathname, opts.publicDir)
			if (publicResult) return publicResult
		}

		if (opts?.fallback) return opts.fallback(req)
		return errorResponse(404, 'NOT_FOUND', 'Not found')
	}
}

export function serialize(body: unknown): string {
	return typeof body === 'string' ? body : JSON.stringify(body)
}

/** Consume an async stream chunk-by-chunk; return false from write to stop early. */
export async function drainStream(
	stream: AsyncIterable<string>,
	write: (chunk: string) => boolean | void,
): Promise<void> {
	try {
		for await (const chunk of stream) {
			if (write(chunk) === false) break
		}
	} catch {
		// Client disconnected
	}
}

/** Convert an HttpResponse to a Web API Response (for adapters using fetch-compatible runtimes) */
export function toWebResponse(result: HttpResponse): Response {
	if ('stream' in result) {
		const stream = result.stream
		const onCancel = result.onCancel
		const encoder = new TextEncoder()
		const readable = new ReadableStream({
			async start(controller) {
				await drainStream(stream, (chunk) => {
					controller.enqueue(encoder.encode(chunk))
				})
				controller.close()
			},
			cancel() {
				onCancel?.()
			},
		})
		return new Response(readable, { status: result.status, headers: result.headers })
	}
	return new Response(serialize(result.body), { status: result.status, headers: result.headers })
}
