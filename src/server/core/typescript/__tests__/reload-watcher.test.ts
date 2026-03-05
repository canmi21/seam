/* src/server/core/typescript/__tests__/reload-watcher.test.ts */
/* oxlint-disable no-promise-executor-return */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { watchReloadTrigger } from '../src/dev/reload-watcher.js'

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

	it('watches directory when trigger file does not exist initially', async () => {
		const freshDir = mkdtempSync(join(tmpdir(), 'seam-reload-nofile-'))
		const triggerPath = join(freshDir, '.reload-trigger')

		const reloads: number[] = []
		const watcher = watchReloadTrigger(freshDir, () => reloads.push(Date.now()))

		try {
			await new Promise((r) => setTimeout(r, 50))

			// Create the trigger file after watcher is set up — first creation fires immediately
			let pending = watcher.nextReload()
			writeFileSync(triggerPath, '1')
			await pending

			expect(reloads.length).toBeGreaterThanOrEqual(1)
			const countAfterFirstCreate = reloads.length

			// The dir watcher callback just created a new file watcher — let it register
			await new Promise((r) => setTimeout(r, 50))

			// Subsequent writes go through the file watcher
			pending = watcher.nextReload()
			writeFileSync(triggerPath, '2')
			await pending

			expect(reloads.length).toBeGreaterThan(countAfterFirstCreate)
		} finally {
			watcher.close()
			rmSync(freshDir, { recursive: true, force: true })
		}
	})
})
