/* examples/features/channel-subscription/src/pages/page.tsx */

import { useState, useRef, useEffect } from 'react'
import { useSeamData, useSeamSubscription } from '@canmi/seam-react'
import { createClient } from '@canmi/seam-client'
import type { ChannelHandle } from '@canmi/seam-client'

interface PageData extends Record<string, unknown> {
	info: { title: string }
}

function ReconnectTestView() {
	const { data, status, retryCount } = useSeamSubscription<{ tick: number; ts: number }>(
		window.location.origin,
		'onLongTick',
		{},
		{ reconnect: { initialDelay: 200, maxRetries: 20, maxDelay: 2_000 } },
	)

	return (
		<div>
			<p data-testid="rc-status">RC Status: {status}</p>
			<p data-testid="rc-tick">RC Tick: {data?.tick ?? 0}</p>
			<p data-testid="rc-retry">RC Retry: {retryCount}</p>
		</div>
	)
}

function SubscriptionView() {
	const { data, status } = useSeamSubscription<{ tick: number }>(window.location.origin, 'onTick', {
		interval: 500,
	})

	return (
		<div>
			<p data-testid="sub-status">Status: {status}</p>
			<p data-testid="sub-tick">Tick: {data?.tick ?? 0}</p>
		</div>
	)
}

function ChannelView() {
	const [connected, setConnected] = useState(false)
	const [messages, setMessages] = useState<{ id: string; text: string }[]>([])
	const [input, setInput] = useState('')
	const channelRef = useRef<ChannelHandle | null>(null)

	function handleConnect() {
		const client = createClient({ baseUrl: window.location.origin })
		const ch = client.channel('echo', { roomId: 'test' })
		ch.on('message', (payload) => {
			const msg = payload as { id: string; text: string }
			setMessages((prev) => [...prev, msg])
		})
		channelRef.current = ch
		setConnected(true)
	}

	async function handleSend() {
		if (!channelRef.current || !input.trim()) return
		await (channelRef.current as unknown as { send: (i: unknown) => Promise<unknown> }).send({
			text: input.trim(),
		})
		setInput('')
	}

	useEffect(() => {
		return () => channelRef.current?.close()
	}, [])

	return (
		<div>
			{!connected ? (
				<button type="button" onClick={handleConnect}>
					Connect Channel
				</button>
			) : (
				<>
					<form
						onSubmit={(e) => {
							e.preventDefault()
							handleSend()
						}}
					>
						<input
							type="text"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder="Type a message..."
							data-testid="ch-input"
						/>
						<button type="submit">Send</button>
					</form>
					<ul data-testid="ch-messages">
						{messages.map((m) => (
							<li key={m.id} data-testid="ch-message">
								{m.text}
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	)
}

export default function HomePage() {
	const data = useSeamData<PageData>()
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])

	return (
		<div>
			<h1>{data.info.title}</h1>

			{mounted && window.location.hash === '#reconnect' && (
				<>
					<h2>Reconnect Test</h2>
					<ReconnectTestView />
				</>
			)}

			<h2>Subscription</h2>
			{mounted && <SubscriptionView />}

			<h2>Channel</h2>
			{mounted && <ChannelView />}
		</div>
	)
}
