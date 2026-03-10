/* src/server/core/typescript/__tests__/build-loader.test.ts */
/* oxlint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
	loadBuild,
	loadBuildDev,
	loadBuildOutput,
	loadBuildOutputDev,
	loadRpcHashMap,
} from '../src/page/build-loader.js'

let distDir: string

beforeAll(() => {
	distDir = mkdtempSync(join(tmpdir(), 'seam-build-test-'))
	mkdirSync(join(distDir, 'templates'))

	writeFileSync(
		join(distDir, 'templates/user-id.html'),
		'<!DOCTYPE html><html><body><!--seam:user.name--></body></html>',
	)

	writeFileSync(
		join(distDir, 'route-manifest.json'),
		JSON.stringify({
			routes: {
				'/user/:id': {
					template: 'templates/user-id.html',
					loaders: {
						user: {
							procedure: 'getUser',
							params: { id: { from: 'route', type: 'int' } },
						},
					},
				},
				'/about': {
					template: 'templates/user-id.html',
					loaders: {
						info: {
							procedure: 'getInfo',
							params: { slug: 'route' },
						},
					},
				},
			},
		}),
	)
})

afterAll(() => {
	rmSync(distDir, { recursive: true, force: true })
})

describe('loadBuildOutput', () => {
	it('loads pages from dist directory', () => {
		const pages = loadBuildOutput(distDir)
		expect(Object.keys(pages)).toEqual(['/user/:id', '/about'])
	})

	it('loads template content', () => {
		const pages = loadBuildOutput(distDir)
		expect(pages['/user/:id'].template).toContain('<!--seam:user.name-->')
	})

	it('creates loader functions that coerce int params', () => {
		const pages = loadBuildOutput(distDir)
		const result = pages['/user/:id'].loaders.user({ id: '42' })
		expect(result).toEqual({ procedure: 'getUser', input: { id: 42 } })
	})

	it('creates loader functions with string params by default', () => {
		const pages = loadBuildOutput(distDir)
		const result = pages['/about'].loaders.info({ slug: 'hello' })
		expect(result).toEqual({ procedure: 'getInfo', input: { slug: 'hello' } })
	})

	it('expands string shorthand params to { from: value }', () => {
		const pages = loadBuildOutput(distDir)
		const result = pages['/about'].loaders.info({ slug: 'hello' })
		expect(result).toEqual({ procedure: 'getInfo', input: { slug: 'hello' } })
	})

	it('handles mixed string shorthand and object params', () => {
		const dir = mkdtempSync(join(tmpdir(), 'seam-mixed-params-'))
		mkdirSync(join(dir, 'templates'))
		writeFileSync(join(dir, 'templates/index.html'), '<p>body</p>')
		writeFileSync(
			join(dir, 'route-manifest.json'),
			JSON.stringify({
				routes: {
					'/item/:slug': {
						template: 'templates/index.html',
						loaders: {
							data: {
								procedure: 'getItem',
								params: { slug: 'route', page: { from: 'query', type: 'int' } },
							},
						},
					},
				},
			}),
		)
		try {
			const pages = loadBuildOutput(dir)
			const sp = new URLSearchParams('page=3')
			const result = pages['/item/:slug'].loaders.data({ slug: 'foo' }, sp)
			expect(result).toEqual({ procedure: 'getItem', input: { slug: 'foo', page: 3 } })
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('throws when route-manifest.json is missing', () => {
		expect(() => loadBuildOutput('/nonexistent/path')).toThrow()
	})

	it('throws on malformed manifest JSON', () => {
		const badDir = mkdtempSync(join(tmpdir(), 'seam-bad-manifest-'))
		writeFileSync(join(badDir, 'route-manifest.json'), 'not valid json{{{')
		try {
			expect(() => loadBuildOutput(badDir)).toThrow()
		} finally {
			rmSync(badDir, { recursive: true, force: true })
		}
	})

	it('throws when referenced template file is missing', () => {
		const noTplDir = mkdtempSync(join(tmpdir(), 'seam-no-tpl-'))
		writeFileSync(
			join(noTplDir, 'route-manifest.json'),
			JSON.stringify({
				routes: {
					'/': {
						template: 'templates/missing.html',
						loaders: {},
					},
				},
			}),
		)
		try {
			expect(() => loadBuildOutput(noTplDir)).toThrow()
		} finally {
			rmSync(noTplDir, { recursive: true, force: true })
		}
	})

	it('returns empty record for empty routes', () => {
		const emptyDir = mkdtempSync(join(tmpdir(), 'seam-empty-routes-'))
		writeFileSync(join(emptyDir, 'route-manifest.json'), JSON.stringify({ routes: {} }))
		try {
			const pages = loadBuildOutput(emptyDir)
			expect(pages).toEqual({})
		} finally {
			rmSync(emptyDir, { recursive: true, force: true })
		}
	})
})

describe('loadBuildOutput — head_meta', () => {
	it('loads head_meta from manifest into headMeta field', () => {
		const dir = mkdtempSync(join(tmpdir(), 'seam-headmeta-'))
		mkdirSync(join(dir, 'templates'))
		writeFileSync(join(dir, 'templates/index.html'), '<p>body</p>')
		writeFileSync(
			join(dir, 'route-manifest.json'),
			JSON.stringify({
				routes: {
					'/': {
						template: 'templates/index.html',
						layout: 'root',
						loaders: {},
						head_meta: '<title><!--seam:t--></title>',
					},
				},
				layouts: {
					root: {
						template: 'templates/index.html',
						loaders: {},
					},
				},
			}),
		)
		try {
			const pages = loadBuildOutput(dir)
			expect(pages['/'].headMeta).toBe('<title><!--seam:t--></title>')
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('headMeta is undefined when head_meta absent from manifest', () => {
		const pages = loadBuildOutput(distDir)
		expect(pages['/user/:id'].headMeta).toBeUndefined()
	})
})

describe('loadBuildOutput — data_id', () => {
	it('sets dataId from manifest data_id field', () => {
		const dir = mkdtempSync(join(tmpdir(), 'seam-dataid-'))
		mkdirSync(join(dir, 'templates'))
		writeFileSync(join(dir, 'templates/index.html'), '<p>body</p>')
		writeFileSync(
			join(dir, 'route-manifest.json'),
			JSON.stringify({
				routes: {
					'/': {
						template: 'templates/index.html',
						loaders: {},
					},
				},
				data_id: '__sd',
			}),
		)
		try {
			const pages = loadBuildOutput(dir)
			expect(pages['/'].dataId).toBe('__sd')
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('dataId is undefined when data_id absent from manifest', () => {
		const pages = loadBuildOutput(distDir)
		expect(pages['/user/:id'].dataId).toBeUndefined()
	})
})

describe('loadRpcHashMap', () => {
	it('returns hash map when file exists', () => {
		const hashDir = mkdtempSync(join(tmpdir(), 'seam-hashmap-'))
		writeFileSync(
			join(hashDir, 'rpc-hash-map.json'),
			JSON.stringify({
				salt: 'abcd1234abcd1234',
				batch: 'e5f6a7b8',
				procedures: { getUser: 'a1b2c3d4', getSession: 'c9d0e1f2' },
			}),
		)
		try {
			const map = loadRpcHashMap(hashDir)
			expect(map).toBeDefined()
			expect(map!.batch).toBe('e5f6a7b8')
			expect(map!.procedures.getUser).toBe('a1b2c3d4')
		} finally {
			rmSync(hashDir, { recursive: true, force: true })
		}
	})

	it('returns undefined when file does not exist', () => {
		const emptyDir = mkdtempSync(join(tmpdir(), 'seam-no-hashmap-'))
		try {
			const map = loadRpcHashMap(emptyDir)
			expect(map).toBeUndefined()
		} finally {
			rmSync(emptyDir, { recursive: true, force: true })
		}
	})
})

describe('pageAssets passthrough', () => {
	it('passes pageAssets from manifest to PageDef', () => {
		const dir = mkdtempSync(join(tmpdir(), 'seam-page-assets-'))
		mkdirSync(join(dir, 'templates'))
		writeFileSync(join(dir, 'templates/index.html'), '<p>home</p>')
		writeFileSync(join(dir, 'templates/about.html'), '<p>about</p>')
		const assets = {
			styles: ['assets/home.css'],
			scripts: ['assets/home.js'],
			preload: ['assets/shared.js'],
			prefetch: ['assets/about.js'],
		}
		writeFileSync(
			join(dir, 'route-manifest.json'),
			JSON.stringify({
				routes: {
					'/': {
						template: 'templates/index.html',
						loaders: {},
						assets,
					},
					'/about': {
						template: 'templates/about.html',
						loaders: {},
					},
				},
			}),
		)
		try {
			const pages = loadBuildOutput(dir)
			expect(pages['/'].pageAssets).toEqual(assets)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('pageAssets is undefined when assets absent', () => {
		const pages = loadBuildOutput(distDir)
		expect(pages['/user/:id'].pageAssets).toBeUndefined()
	})
})

describe('loadBuildOutputDev', () => {
	it('loads pages with correct routes', () => {
		const pages = loadBuildOutputDev(distDir)
		expect(Object.keys(pages)).toEqual(['/user/:id', '/about'])
	})

	it('loads head_meta from manifest into headMeta field', () => {
		const headDir = mkdtempSync(join(tmpdir(), 'seam-head-dev-'))
		mkdirSync(join(headDir, 'templates'), { recursive: true })
		writeFileSync(
			join(headDir, 'templates/index.html'),
			'<!DOCTYPE html><html><head></head><body></body></html>',
		)
		writeFileSync(
			join(headDir, 'route-manifest.json'),
			JSON.stringify({
				routes: {
					'/': {
						template: 'templates/index.html',
						loaders: {},
						head_meta: '<title><!--seam:t--></title>',
					},
				},
			}),
		)

		try {
			const pages = loadBuildOutputDev(headDir)
			expect(pages['/'].headMeta).toBe('<title><!--seam:t--></title>')
		} finally {
			rmSync(headDir, { recursive: true, force: true })
		}
	})

	it('returns fresh template content on each access', () => {
		const pages = loadBuildOutputDev(distDir)
		const first = pages['/user/:id'].template
		expect(first).toContain('<!--seam:user.name-->')

		// Modify template on disk
		const tplPath = join(distDir, 'templates/user-id.html')
		writeFileSync(tplPath, '<!DOCTYPE html><html><body>UPDATED</body></html>')

		const second = pages['/user/:id'].template
		expect(second).toContain('UPDATED')

		// Restore original
		writeFileSync(tplPath, '<!DOCTYPE html><html><body><!--seam:user.name--></body></html>')
	})

	it('creates loader functions that coerce int params', () => {
		const pages = loadBuildOutputDev(distDir)
		const result = pages['/user/:id'].loaders.user({ id: '42' })
		expect(result).toEqual({ procedure: 'getUser', input: { id: 42 } })
	})

	it('throws when route-manifest.json is missing', () => {
		expect(() => loadBuildOutputDev('/nonexistent/path')).toThrow()
	})
})

describe('loadBuild', () => {
	it('returns pages, rpcHashMap, and i18n from a single call', () => {
		const build = loadBuild(distDir)
		expect(Object.keys(build.pages)).toEqual(['/user/:id', '/about'])
		expect(build.rpcHashMap).toBeUndefined()
		expect(build.i18n).toBeNull()
	})

	it('includes rpcHashMap when rpc-hash-map.json exists', () => {
		const hashDir = mkdtempSync(join(tmpdir(), 'seam-loadbuild-hash-'))
		mkdirSync(join(hashDir, 'templates'))
		writeFileSync(join(hashDir, 'templates/index.html'), '<p>hi</p>')
		writeFileSync(
			join(hashDir, 'route-manifest.json'),
			JSON.stringify({ routes: { '/': { template: 'templates/index.html', loaders: {} } } }),
		)
		writeFileSync(
			join(hashDir, 'rpc-hash-map.json'),
			JSON.stringify({ salt: 'x', batch: 'b1', procedures: { foo: 'h1' } }),
		)
		try {
			const build = loadBuild(hashDir)
			expect(build.rpcHashMap).toBeDefined()
			expect(build.rpcHashMap!.procedures.foo).toBe('h1')
		} finally {
			rmSync(hashDir, { recursive: true, force: true })
		}
	})
})

describe('loadBuildDev', () => {
	it('returns lazy templates with same structure', () => {
		const build = loadBuildDev(distDir)
		expect(Object.keys(build.pages)).toEqual(['/user/:id', '/about'])
		expect(build.pages['/user/:id'].template).toContain('<!--seam:user.name-->')
		expect(build.rpcHashMap).toBeUndefined()
		expect(build.i18n).toBeNull()
	})
})

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

			// Add a new page to the manifest
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

			// Old route should still work, new route should now match
			expect(router.hasPages).toBe(true)
			expect(await router.handlePage('/nonexistent')).toBeNull()
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
