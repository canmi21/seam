/* examples/features/stream-upload/src/pages/page.tsx */

import { useState, useRef } from 'react'
import { useSeamData, useSeamStream } from '@canmi/seam-react'
import { createClient } from '@canmi/seam-client'

interface PageData extends Record<string, unknown> {
	info: { title: string }
}

// Mounted only after "Start Stream" click, so useSeamStream auto-starts safely
function StreamView() {
	const { chunks, status, cancel } = useSeamStream<{ n: number }>(
		window.location.origin,
		'countStream',
		{ max: 5 },
	)

	return (
		<div>
			<p>
				{chunks.map((c) => c.n).join(', ') || 'waiting...'}
				{status === 'completed' && ' — Done'}
			</p>
			{status === 'streaming' && (
				<button type="button" onClick={cancel}>
					Cancel
				</button>
			)}
		</div>
	)
}

function UploadSection() {
	const fileRef = useRef<HTMLInputElement>(null)
	const [result, setResult] = useState<{
		fileId: string
		filename: string
		size: number
	} | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function handleUpload() {
		const file = fileRef.current?.files?.[0]
		if (!file) return
		setError(null)
		setResult(null)
		try {
			const client = createClient({ baseUrl: window.location.origin })
			const data = (await client.upload('echoUpload', { filename: file.name }, file)) as {
				fileId: string
				filename: string
				size: number
			}
			setResult(data)
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Upload failed')
		}
	}

	return (
		<div>
			<input type="file" ref={fileRef} />
			<button type="button" onClick={handleUpload}>
				Upload
			</button>
			{result && (
				<dl>
					<dt>File ID</dt>
					<dd>{result.fileId}</dd>
					<dt>Filename</dt>
					<dd>{result.filename}</dd>
					<dt>Size</dt>
					<dd>{result.size} bytes</dd>
				</dl>
			)}
			{error && <p style={{ color: 'red' }}>{error}</p>}
		</div>
	)
}

export default function HomePage() {
	const data = useSeamData<PageData>()
	const [streaming, setStreaming] = useState(false)

	return (
		<div>
			<h1>{data.info.title}</h1>

			<h2>Stream</h2>
			{!streaming ? (
				<button type="button" onClick={() => setStreaming(true)}>
					Start Stream
				</button>
			) : (
				<StreamView />
			)}

			<h2>Upload</h2>
			<UploadSection />
		</div>
	)
}
