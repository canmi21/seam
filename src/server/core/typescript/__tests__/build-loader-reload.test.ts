/* src/server/core/typescript/__tests__/build-loader-reload.test.ts */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBuildDev } from '../src/page/build-loader.js'

describe('loadBuildDev + router.reload integration', () => {
	it('new page is served after reload with updated manifest', async () => {
		const { createRouter } = await import('../src/router/index.js')
		const { t } = await import('../src/types/index.js')

		const dir = mkdtempSync(join(tmpdir(), 'seam-reload-integration-'))
		mkdirSync(join(dir, 'templates'))
		writeFileSync(join(dir, 'templates/home.html'), '<p>home</p>')
		writeFileSync(
			join(dir, 'route-manifest.json'),
			JSON.stringify({
				routes: {
					'/': { template: 'templates/home.html', loaders: {} },
				},
			}),
		)

		const procedures = {
			ping: {
				input: t.object({}),
				output: t.object({ ok: t.boolean() }),
				handler: () => ({ ok: true }),
			},
		}

		try {
			const build = loadBuildDev(dir)
			const router = createRouter(procedures, { pages: build.pages, i18n: build.i18n })
			expect(router.hasPages).toBe(true)
			expect(await router.handlePage('/about')).toBeNull()

			writeFileSync(join(dir, 'templates/about.html'), '<p>about</p>')
			writeFileSync(
				join(dir, 'route-manifest.json'),
				JSON.stringify({
					routes: {
						'/': { template: 'templates/home.html', loaders: {} },
						'/about': { template: 'templates/about.html', loaders: {} },
					},
				}),
			)

			const freshBuild = loadBuildDev(dir)
			router.reload(freshBuild)

			expect(router.hasPages).toBe(true)
			expect(await router.handlePage('/nonexistent')).toBeNull()
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
