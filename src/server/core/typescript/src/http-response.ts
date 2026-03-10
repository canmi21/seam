/* src/server/core/typescript/src/http-response.ts */

import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { SeamError } from './errors.js'
import { MIME_TYPES } from './mime.js'
import type { HttpBodyResponse, HttpResponse } from './http.js'

const JSON_HEADER = { 'Content-Type': 'application/json' }
const PUBLIC_CACHE = 'public, max-age=3600'
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
const TEXT_ENCODINGS = new Set([
	'application/javascript',
	'application/json',
	'application/manifest+json',
	'application/xml',
	'image/svg+xml',
])

function normalizeBinaryBody(body: ArrayBufferView | ArrayBuffer): Uint8Array {
	if (body instanceof Uint8Array) return body
	if (body instanceof ArrayBuffer) return new Uint8Array(body)
	return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
}

function isTextContentType(contentType: string): boolean {
	const mime = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
	return mime.startsWith('text/') || TEXT_ENCODINGS.has(mime)
}

async function readResponseBody(
	filePath: string,
	contentType: string,
): Promise<string | Uint8Array> {
	const content = await readFile(filePath)
	return isTextContentType(contentType) ? content.toString('utf-8') : content
}

export function jsonResponse(status: number, body: unknown): HttpBodyResponse {
	return { status, headers: JSON_HEADER, body }
}

export function errorResponse(status: number, code: string, message: string): HttpBodyResponse {
	return jsonResponse(status, new SeamError(code, message).toJSON())
}

export async function handleStaticAsset(
	assetPath: string,
	staticDir: string,
): Promise<HttpBodyResponse> {
	if (assetPath.includes('..')) {
		return errorResponse(403, 'VALIDATION_ERROR', 'Forbidden')
	}

	const filePath = join(staticDir, assetPath)
	try {
		const ext = extname(filePath)
		const contentType = MIME_TYPES[ext] || 'application/octet-stream'
		const content = await readResponseBody(filePath, contentType)
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

export async function handlePublicFile(
	pathname: string,
	publicDir: string,
): Promise<HttpBodyResponse | null> {
	if (pathname.includes('..')) return null
	const filePath = join(publicDir, pathname)
	try {
		const ext = extname(filePath)
		const contentType = MIME_TYPES[ext] || 'application/octet-stream'
		const content = await readResponseBody(filePath, contentType)
		return {
			status: 200,
			headers: { 'Content-Type': contentType, 'Cache-Control': PUBLIC_CACHE },
			body: content,
		}
	} catch {
		return null
	}
}

export function serialize(body: unknown): string | Uint8Array {
	if (typeof body === 'string') return body
	if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
		return normalizeBinaryBody(body)
	}
	return JSON.stringify(body)
}

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
	return new Response(serialize(result.body) as BodyInit, {
		status: result.status,
		headers: result.headers,
	})
}
