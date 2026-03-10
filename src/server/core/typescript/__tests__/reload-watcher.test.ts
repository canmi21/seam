/* src/server/core/typescript/__tests__/reload-watcher.test.ts */
/* oxlint-disable no-promise-executor-return */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
	createReloadWatcher,
	type ReloadWatcherBackend,
	watchReloadTrigger,
} from '../src/dev/reload-watcher.js'

let distDir: string

beforeAll(() => {
	distDir = mkdtempSync(join(tmpdir(), 'seam-reload-test-'))
})

afterAll(() => {
	rmSync(distDir, { recursive: true, force: true })
})

describe('watchReloadTrigger', () => {
	it('calls onReload when trigger file is written', async () => {
		// Pre-create the trigger file so watch() attaches directly
		const triggerPath = join(distDir, '.reload-trigger')
		writeFileSync(triggerPath, '0')

		const reloads: number[] = []
		const watcher = watchReloadTrigger(distDir, () => reloads.push(Date.now()))

		try {
			// fs.watch needs a tick for the OS to register the watcher
			await new Promise((r) => setTimeout(r, 50))

			const pending = watcher.nextReload()
			writeFileSync(triggerPath, String(Date.now()))
			await pending

			expect(reloads.length).toBeGreaterThanOrEqual(1)
		} finally {
			watcher.close()
		}
	})

	it('close() stops watching cleanly', async () => {
		const triggerPath = join(distDir, '.reload-trigger')
		writeFileSync(triggerPath, '0')

		const reloads: number[] = []
		const watcher = watchReloadTrigger(distDir, () => reloads.push(Date.now()))
		watcher.close()

		// Write after close — should not fire
		writeFileSync(triggerPath, '2')
		await new Promise((r) => setTimeout(r, 100))

		expect(reloads.length).toBe(0)
	})

	it('nextReload() rejects after close', async () => {
		const triggerPath = join(distDir, '.reload-trigger')
		writeFileSync(triggerPath, '0')

		const watcher = watchReloadTrigger(distDir, () => {})
		watcher.close()

		await expect(watcher.nextReload()).rejects.toThrow('watcher closed')
	})
})

class FakeReloadWatcherBackend implements ReloadWatcherBackend {
	private readonly existing = new Set<string>()
	private readonly watchers = new Map<
		string,
		{ onChange: () => void; onError: (error: unknown) => void }
	>()
	private readonly pollers = new Set<() => void>()

	fileExists(path: string): boolean {
		return this.existing.has(path)
	}

	watchFile(path: string, onChange: () => void, onError: (error: unknown) => void) {
		if (!this.existing.has(path)) {
			throw Object.assign(new Error('missing file'), { code: 'ENOENT' })
		}
		this.watchers.set(path, { onChange, onError })
		return {
			close: () => {
				this.watchers.delete(path)
			},
		}
	}

	setPoll(callback: () => void) {
		this.pollers.add(callback)
		return {
			close: () => {
				this.pollers.delete(callback)
			},
		}
	}

	createFile(path: string) {
		this.existing.add(path)
	}

	deleteFile(path: string) {
		this.existing.delete(path)
	}

	emitChange(path: string) {
		this.watchers.get(path)?.onChange()
	}

	emitError(path: string, error: unknown) {
		this.watchers.get(path)?.onError(error)
	}

	tick() {
		for (const poller of this.pollers) poller()
	}
}

describe('createReloadWatcher', () => {
	it('waits for the trigger file to appear, then switches to file watching', async () => {
		const backend = new FakeReloadWatcherBackend()
		const onReload = vi.fn()
		const watcher = createReloadWatcher('/virtual/dist', onReload, backend)
		const triggerPath = '/virtual/dist/.reload-trigger'

		try {
			const firstReload = watcher.nextReload()
			backend.tick()
			expect(onReload).not.toHaveBeenCalled()

			backend.createFile(triggerPath)
			backend.tick()
			await firstReload

			expect(onReload).toHaveBeenCalledTimes(1)

			const secondReload = watcher.nextReload()
			backend.emitChange(triggerPath)
			await secondReload

			expect(onReload).toHaveBeenCalledTimes(2)
		} finally {
			watcher.close()
		}
	})

	it('falls back to polling again if the file watcher reports ENOENT', async () => {
		const backend = new FakeReloadWatcherBackend()
		const onReload = vi.fn()
		const watcher = createReloadWatcher('/virtual/dist', onReload, backend)
		const triggerPath = '/virtual/dist/.reload-trigger'

		try {
			backend.createFile(triggerPath)
			const firstReload = watcher.nextReload()
			backend.tick()
			await firstReload

			backend.deleteFile(triggerPath)
			backend.emitError(triggerPath, Object.assign(new Error('gone'), { code: 'ENOENT' }))
			const secondReload = watcher.nextReload()
			backend.tick()
			expect(onReload).toHaveBeenCalledTimes(1)

			backend.createFile(triggerPath)
			backend.tick()
			await secondReload

			expect(onReload).toHaveBeenCalledTimes(2)
		} finally {
			watcher.close()
		}
	})
})
