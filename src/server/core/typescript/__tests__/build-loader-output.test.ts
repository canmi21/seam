/* src/server/core/typescript/__tests__/build-loader-output.test.ts */
/* oxlint-disable @typescript-eslint/no-non-null-assertion */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBuildOutput, loadBuildOutputDev } from '../src/page/build-loader.js'
import { createBaseBuildFixture } from './build-loader-test-helpers.js'

let fixture: ReturnType<typeof createBaseBuildFixture>
let distDir: string

beforeAll(() => {
	fixture = createBaseBuildFixture()
	distDir = fixture.distDir
})

afterAll(() => {
	fixture.cleanup()
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

		writeFileSync(
			join(distDir, 'templates/user-id.html'),
			'<!DOCTYPE html><html><body>UPDATED</body></html>',
		)

		const second = pages['/user/:id'].template
		expect(second).toContain('UPDATED')
		fixture.restoreUserTemplate()
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
