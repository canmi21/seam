/* src/server/core/typescript/src/dev/reload-watcher.ts */

import { existsSync, watch } from 'node:fs'
import { join } from 'node:path'

export interface ReloadWatcher {
	close(): void
	/** Resolves on the next reload event. Rejects if the watcher is already closed. */
	nextReload(): Promise<void>
}

interface Closable {
	close(): void
}

export interface ReloadWatcherBackend {
	watchFile(path: string, onChange: () => void, onError: (error: unknown) => void): Closable
	fileExists(path: string): boolean
	setPoll(callback: () => void, intervalMs: number): Closable
}

const nodeReloadWatcherBackend: ReloadWatcherBackend = {
	watchFile(path, onChange, onError) {
		const watcher = watch(path, () => onChange())
		watcher.on('error', onError)
		return watcher
	},
	fileExists(path) {
		return existsSync(path)
	},
	setPoll(callback, intervalMs) {
		const timer = setInterval(callback, intervalMs)
		return {
			close() {
				clearInterval(timer)
			},
		}
	},
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'ENOENT'
	)
}

export function createReloadWatcher(
	distDir: string,
	onReload: () => void,
	backend: ReloadWatcherBackend,
): ReloadWatcher {
	const triggerPath = join(distDir, '.reload-trigger')
	let watcher: Closable | null = null
	let poller: Closable | null = null
	let closed = false
	let pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = []

	const notify = () => {
		onReload()
		const batch = pending
		pending = []
		for (const p of batch) p.resolve()
	}

	const nextReload = (): Promise<void> => {
		if (closed) return Promise.reject(new Error('watcher closed'))
		return new Promise((resolve, reject) => {
			pending.push({ resolve, reject })
		})
	}

	const closeAll = () => {
		closed = true
		const batch = pending
		pending = []
		const err = new Error('watcher closed')
		for (const p of batch) p.reject(err)
	}

	const stopWatcher = () => {
		watcher?.close()
		watcher = null
	}

	const stopPoller = () => {
		poller?.close()
		poller = null
	}

	const startPolling = () => {
		if (closed || poller) return
		poller = backend.setPoll(() => {
			if (!backend.fileExists(triggerPath)) return
			stopPoller()
			// First appearance counts as a reload signal.
			notify()
			startWatchingFile()
		}, 50)
	}

	const startWatchingFile = () => {
		if (closed) return
		try {
			watcher = backend.watchFile(
				triggerPath,
				() => notify(),
				(error) => {
					stopWatcher()
					if (!closed && isMissingFileError(error)) {
						startPolling()
					}
				},
			)
		} catch (error) {
			stopWatcher()
			if (isMissingFileError(error)) {
				startPolling()
				return
			}
			throw error
		}
	}

	startWatchingFile()
	return {
		close() {
			stopWatcher()
			stopPoller()
			closeAll()
		},
		nextReload,
	}
}

export function watchReloadTrigger(distDir: string, onReload: () => void): ReloadWatcher {
	return createReloadWatcher(distDir, onReload, nodeReloadWatcherBackend)
}
