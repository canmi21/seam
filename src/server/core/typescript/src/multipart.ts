/* src/server/core/typescript/src/multipart.ts */

import type { SeamFileHandle } from './procedure.js'

export interface MultipartSource {
	headers: { get(name: string): string | null }
	json(): Promise<unknown>
	formData(): Promise<FormData>
}

export function buildMultipartFields(req: MultipartSource): {
	body: () => Promise<unknown>
	file?: () => Promise<SeamFileHandle | null>
} {
	const contentType = req.headers.get('content-type') ?? ''
	const isMultipart = contentType.startsWith('multipart/form-data')
	let cache: FormData | undefined
	const getFormData = async () => (cache ??= await req.formData())
	return {
		body: isMultipart
			? async () => JSON.parse((await getFormData()).get('metadata') as string) as unknown
			: () => req.json(),
		file: isMultipart
			? async () => {
					const f = (await getFormData()).get('file') as File | null
					return f ? { stream: () => f.stream() } : null
				}
			: undefined,
	}
}
