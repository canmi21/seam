/* src/server/adapter/hono/src/index.ts */

import { createHttpHandler, toWebResponse, startChannelWs } from '@canmi/seam-server'
import type {
	DefinitionMap,
	Router,
	HttpHandler,
	HttpHandlerOptions,
	RpcHashMap,
	ChannelWsOptions,
	ChannelWsSession,
	SseOptions,
} from '@canmi/seam-server'
import type { MiddlewareHandler } from 'hono'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Hono-compatible upgradeWebSocket factory.
 * Runtimes (Deno, Bun, Cloudflare) provide their own implementation;
 * the user injects it via options so the adapter stays runtime-agnostic.
 */
export type UpgradeWebSocket = (
	handler: (c: any) => {
		onOpen?: (evt: any, ws: any) => void
		onMessage?: (evt: any, ws: any) => void
		onClose?: (evt: any, ws: any) => void
	},
) => MiddlewareHandler

/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SeamHonoOptions {
	staticDir?: string
	publicDir?: string
	fallback?: HttpHandler
	rpcHashMap?: RpcHashMap
	upgradeWebSocket?: UpgradeWebSocket
	wsOptions?: ChannelWsOptions
	sseOptions?: SseOptions
}

const SEAM_PREFIX = '/_seam/'
const PROCEDURE_PREFIX = '/_seam/procedure/'
const EVENTS_SUFFIX = '.events'

// Track WS sessions without patching the ws object
const wsSessions = new WeakMap<object, ChannelWsSession>()

/** Hono middleware that handles all /_seam/* routes via the seam router */
export function seam<T extends DefinitionMap>(
	router: Router<T>,
	opts?: SeamHonoOptions,
): MiddlewareHandler {
	const handlerOpts: HttpHandlerOptions = {}
	if (opts?.staticDir) handlerOpts.staticDir = opts.staticDir
	if (opts?.publicDir) handlerOpts.publicDir = opts.publicDir
	if (opts?.fallback) handlerOpts.fallback = opts.fallback
	if (opts?.rpcHashMap) handlerOpts.rpcHashMap = opts.rpcHashMap
	if (opts?.sseOptions) handlerOpts.sseOptions = opts.sseOptions

	const handler = createHttpHandler(router, handlerOpts)

	return async (c, next) => {
		const url = new URL(c.req.url)

		if (!url.pathname.startsWith(SEAM_PREFIX)) {
			if (!opts?.publicDir || c.req.method !== 'GET') return next()
			// Public file: let handler check the file, fall through to next() on miss
			const raw = c.req.raw
			const result = await handler({
				method: raw.method,
				url: raw.url,
				body: () => Promise.reject(new Error('no body')),
				header: (name) => raw.headers.get(name),
			})
			if (result.status === 404 && !('stream' in result)) return next()
			return toWebResponse(result)
		}

		// WebSocket upgrade for channel paths
		if (
			opts?.upgradeWebSocket &&
			c.req.header('upgrade') === 'websocket' &&
			url.pathname.startsWith(PROCEDURE_PREFIX) &&
			url.pathname.endsWith(EVENTS_SUFFIX)
		) {
			const channelName = url.pathname.slice(PROCEDURE_PREFIX.length, -EVENTS_SUFFIX.length)
			const rawInput = url.searchParams.get('input')
			let channelInput: unknown
			try {
				channelInput = rawInput ? JSON.parse(rawInput) : {}
			} catch {
				return c.text('Invalid input query parameter', 400)
			}

			const wsHandler = opts.upgradeWebSocket(() => ({
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				onOpen(_evt: any, ws: any) {
					const wsObj = ws as object
					const session = startChannelWs(
						router,
						channelName,
						channelInput,
						{ send: (data: string) => (ws as { send: (d: string) => void }).send(data) },
						opts.wsOptions,
					)
					wsSessions.set(wsObj, session)
				},
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				onMessage(evt: any, ws: any) {
					const session = wsSessions.get(ws as object)
					const text =
						typeof (evt as { data: unknown }).data === 'string'
							? (evt as { data: string }).data
							: String((evt as { data: unknown }).data)
					session?.onMessage(text)
				},
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				onClose(_evt: any, ws: any) {
					const session = wsSessions.get(ws as object)
					session?.close()
					wsSessions.delete(ws as object)
				},
			}))
			return wsHandler(c, next)
		}

		const raw = c.req.raw
		const contentType = raw.headers.get('content-type') ?? ''
		const isMultipart = contentType.startsWith('multipart/form-data')

		let formDataCache: FormData | undefined
		const getFormData = async () => (formDataCache ??= await raw.formData())

		const result = await handler({
			method: raw.method,
			url: raw.url,
			body: isMultipart
				? async () => JSON.parse((await getFormData()).get('metadata') as string) as unknown
				: () => raw.json(),
			header: (name) => raw.headers.get(name),
			file: isMultipart
				? async () => {
						const f = (await getFormData()).get('file') as File | null
						return f ? { stream: () => f.stream() } : null
					}
				: undefined,
		})

		return toWebResponse(result)
	}
}
